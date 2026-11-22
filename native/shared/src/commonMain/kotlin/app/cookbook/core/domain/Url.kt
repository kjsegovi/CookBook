package app.cookbook.core.domain

// A WHATWG URL parser for the `http` and `https` schemes only, producing `URL.href`. It exists because the
// TypeScript normalises links with `new URL(...)` and the Kotlin port must agree with it byte for byte.
// Not covered: IDNA mapping beyond lower-casing (no NFC or compatibility mapping) and IPv6 with an embedded IPv4 part.
// Both are rejected or passed through rather than guessed at.

private val DEFAULT_PORTS = mapOf("http" to 80, "https" to 443)

private const val HEX = "0123456789ABCDEF"

private fun utf8(cp: Int): List<Int> = when {
    cp < 0x80 -> listOf(cp)
    cp < 0x800 -> listOf(0xC0 or (cp shr 6), 0x80 or (cp and 0x3F))
    cp < 0x10000 -> listOf(0xE0 or (cp shr 12), 0x80 or ((cp shr 6) and 0x3F), 0x80 or (cp and 0x3F))
    else -> listOf(0xF0 or (cp shr 18), 0x80 or ((cp shr 12) and 0x3F), 0x80 or ((cp shr 6) and 0x3F), 0x80 or (cp and 0x3F))
}

private fun codePoints(s: String): List<Int> {
    val out = ArrayList<Int>()
    var i = 0
    while (i < s.length) {
        val c = s[i]
        when {
            c.isHighSurrogate() && i + 1 < s.length && s[i + 1].isLowSurrogate() -> { out.add(0x10000 + ((c.code - 0xD800) shl 10) + (s[i + 1].code - 0xDC00)); i += 2 }
            c.isSurrogate() -> { out.add(0xFFFD); i++ }
            else -> { out.add(c.code); i++ }
        }
    }
    return out
}

/** Percent-encodes ASCII characters for which `escape` is true and every non-ASCII character. */
private fun encode(s: String, escape: (Char) -> Boolean): String {
    val sb = StringBuilder()
    for (cp in codePoints(s)) {
        if (cp < 0x80 && !escape(cp.toChar())) { sb.append(cp.toChar()); continue }
        for (b in utf8(cp)) sb.append('%').append(HEX[b shr 4]).append(HEX[b and 15])
    }
    return sb.toString()
}

private fun c0OrSpaceOrDel(c: Char) = c <= ' ' || c.code > 0x7E
private val pathEscapes = " \"#<>?`{}^"
private fun inPathSet(c: Char) = c0OrSpaceOrDel(c) || c in pathEscapes
private fun inQuerySet(c: Char) = c0OrSpaceOrDel(c) || c in "\"#<>'"
private fun inFragmentSet(c: Char) = c0OrSpaceOrDel(c) || c in "\"<>`"

private fun percentDecode(s: String): String {
    val bytes = ArrayList<Byte>()
    var i = 0
    while (i < s.length) {
        val c = s[i]
        if (c == '%' && i + 2 < s.length && s[i + 1].isHexDigit() && s[i + 2].isHexDigit()) {
            bytes.add(s.substring(i + 1, i + 3).toInt(16).toByte()); i += 3
        } else {
            for (b in utf8(codePoints(c.toString())[0])) bytes.add(b.toByte())
            i++
        }
    }
    return bytes.toByteArray().decodeToString()
}

private fun Char.isHexDigit() = this in '0'..'9' || this in 'a'..'f' || this in 'A'..'F'

// RFC 3492
private fun punycode(label: String): String {
    val cps = codePoints(label)
    val out = StringBuilder()
    for (cp in cps) if (cp < 0x80) out.append(cp.toChar())
    val basic = out.length
    var handled = basic
    if (basic > 0) out.append('-')
    var n = 128
    var delta = 0
    var bias = 72
    fun digit(d: Int) = (if (d < 26) 'a' + d else '0' + (d - 26))
    fun adapt(d0: Int, points: Int, first: Boolean): Int {
        var d = if (first) d0 / 700 else d0 / 2
        d += d / points
        var k = 0
        while (d > 455) { d /= 35; k += 36 }
        return k + 36 * d / (d + 38)
    }
    while (handled < cps.size) {
        val m = cps.filter { it >= n }.min()
        delta += (m - n) * (handled + 1)
        n = m
        for (cp in cps) {
            if (cp < n) delta++
            if (cp == n) {
                var q = delta
                var k = 36
                while (true) {
                    val t = if (k <= bias) 1 else if (k >= bias + 26) 26 else k - bias
                    if (q < t) break
                    out.append(digit(t + (q - t) % (36 - t)))
                    q = (q - t) / (36 - t)
                    k += 36
                }
                out.append(digit(q))
                bias = adapt(delta, handled + 1, handled == basic)
                delta = 0
                handled++
            }
        }
        delta++
        n++
    }
    return out.toString()
}

private fun forbiddenInHost(c: Char) = c <= ' ' || c == '\u007F' || c in "#/:<>?@[\\]^|%"

private fun parseIpv4Number(part: String): Long? {
    if (part.isEmpty()) return null
    var s = part
    var radix = 10
    if (s.length >= 2 && (s.startsWith("0x") || s.startsWith("0X"))) { s = s.substring(2); radix = 16 }
    else if (s.length >= 2 && s[0] == '0') { s = s.substring(1); radix = 8 }
    if (s.isEmpty()) return 0
    var acc = 0L
    for (c in s) {
        val d = when (c) { in '0'..'9' -> c - '0'; in 'a'..'f' -> c - 'a' + 10; in 'A'..'F' -> c - 'A' + 10; else -> return null }
        if (d >= radix) return null
        acc = acc * radix + d
        if (acc > 0xFFFFFFFFFFL) acc = 0xFFFFFFFFFFL
    }
    return acc
}

private fun endsInNumber(host: String): Boolean {
    val parts = host.split('.').toMutableList()
    if (parts.last().isEmpty()) { if (parts.size == 1) return false; parts.removeAt(parts.size - 1) }
    val last = parts.last()
    if (last.isNotEmpty() && last.all { it in '0'..'9' }) return true
    return (last.startsWith("0x") || last.startsWith("0X")) && last.drop(2).all { it.isHexDigit() }
}

private fun ipv4(host: String): String? {
    val parts = host.split('.').toMutableList()
    if (parts.last().isEmpty() && parts.size > 1) parts.removeAt(parts.size - 1)
    if (parts.size > 4) return null
    val numbers = parts.map { parseIpv4Number(it) ?: return null }
    if (numbers.dropLast(1).any { it > 255 }) return null
    var limit = 1L
    repeat(5 - numbers.size) { limit *= 256 }
    if (numbers.last() >= limit) return null
    var address = numbers.last()
    numbers.dropLast(1).forEachIndexed { i, n -> var f = n; repeat(3 - i) { f *= 256 }; address += f }
    return listOf(24, 16, 8, 0).joinToString(".") { ((address shr it) and 255).toString() }
}

private fun ipv6(s: String): String? {
    if (s.contains('.')) return null
    val pieces: List<Int>
    fun groups(text: String): List<Int>? {
        if (text.isEmpty()) return emptyList()
        return text.split(':').map { g -> if (g.isEmpty() || g.length > 4 || !g.all(Char::isHexDigit)) return null else g.toInt(16) }
    }
    val gap = s.indexOf("::")
    if (gap >= 0) {
        if (s.indexOf("::", gap + 1) >= 0) return null
        val left = groups(s.substring(0, gap)) ?: return null
        val right = groups(s.substring(gap + 2)) ?: return null
        if (left.size + right.size > 7) return null
        pieces = left + List(8 - left.size - right.size) { 0 } + right
    } else {
        pieces = groups(s) ?: return null
        if (pieces.size != 8) return null
    }
    var bestStart = -1
    var bestLen = 0
    var i = 0
    while (i < 8) {
        if (pieces[i] != 0) { i++; continue }
        var j = i
        while (j < 8 && pieces[j] == 0) j++
        if (j - i > bestLen) { bestStart = i; bestLen = j - i }
        i = j
    }
    if (bestLen < 2) bestStart = -1
    val sb = StringBuilder()
    var ignore0 = false
    for (k in 0 until 8) {
        if (ignore0 && pieces[k] == 0) continue
        ignore0 = false
        if (bestStart == k) { sb.append(if (k == 0) "::" else ":"); ignore0 = true; continue }
        sb.append(pieces[k].toString(16))
        if (k != 7) sb.append(':')
    }
    return sb.toString()
}

private fun parseHost(raw: String): String? {
    if (raw.startsWith("[")) {
        if (!raw.endsWith("]")) return null
        return ipv6(raw.substring(1, raw.length - 1))?.let { "[$it]" }
    }
    val decoded = percentDecode(raw)
    if ('�' in decoded) return null
    val mapped = decoded.lowercase().replace('。', '.').replace('．', '.').replace('｡', '.')
    val ascii = mapped.split('.').joinToString(".") { label -> if (label.all { it.code < 0x80 }) label else "xn--" + punycode(label) }
    if (ascii.isEmpty() || ascii.any(::forbiddenInHost)) return null
    return if (endsInNumber(ascii)) ipv4(ascii) else ascii
}

private fun isDoubleDot(seg: String) = seg.lowercase() in setOf("..", ".%2e", "%2e.", "%2e%2e")
private fun isSingleDot(seg: String) = seg.lowercase() in setOf(".", "%2e")

private fun parsePath(raw: String): String {
    if (raw.isEmpty()) return "/"
    val segments = raw.substring(1).split('/', '\\')
    val path = ArrayList<String>()
    segments.forEachIndexed { index, seg ->
        val last = index == segments.lastIndex
        when {
            isDoubleDot(seg) -> { if (path.isNotEmpty()) path.removeAt(path.size - 1); if (last) path.add("") }
            isSingleDot(seg) -> if (last) path.add("")
            else -> path.add(encode(seg, ::inPathSet))
        }
    }
    return "/" + path.joinToString("/")
}

/** `new URL(input).href` for an http or https link, or null when the URL standard would reject it or the scheme differs. */
internal fun parseHttpUrl(input: String): String? {
    val s = input.trim { it <= ' ' }.filter { it != '\t' && it != '\n' && it != '\r' }
    val colon = s.indexOf(':')
    if (colon <= 0 || !s[0].let { it in 'a'..'z' || it in 'A'..'Z' }) return null
    if (!s.substring(0, colon).all { it in 'a'..'z' || it in 'A'..'Z' || it in '0'..'9' || it in "+-." }) return null
    val scheme = s.substring(0, colon).lowercase()
    val defaultPort = DEFAULT_PORTS[scheme] ?: return null
    val rest = s.substring(colon + 1)
    var i = 0
    while (i < rest.length && (rest[i] == '/' || rest[i] == '\\')) i++
    var end = i
    while (end < rest.length && rest[end] !in "/\\?#") end++
    val authority = rest.substring(i, end)
    val tail = rest.substring(end)

    val at = authority.lastIndexOf('@')
    if (at >= 0) {
        val credentials = authority.substring(0, at)
        if (credentials.isNotEmpty() && credentials != ":") return null  // the app rejects embedded credentials
    }
    val hostPort = authority.substring(at + 1)
    val hostText: String
    val portText: String
    if (hostPort.startsWith("[")) {
        val close = hostPort.indexOf(']')
        if (close < 0) return null
        hostText = hostPort.substring(0, close + 1)
        val after = hostPort.substring(close + 1)
        if (after.isNotEmpty() && !after.startsWith(":")) return null
        portText = after.drop(1)
    } else {
        val c = hostPort.indexOf(':')
        hostText = if (c < 0) hostPort else hostPort.substring(0, c)
        portText = if (c < 0) "" else hostPort.substring(c + 1)
    }
    if (hostText.isEmpty()) return null
    var port = ""
    if (portText.isNotEmpty()) {
        if (!portText.all { it in '0'..'9' }) return null
        val digits = portText.trimStart('0')
        if (digits.length > 5) return null
        val value = if (digits.isEmpty()) 0 else digits.toInt()
        if (value > 65535) return null
        if (value != defaultPort) port = ":$value"
    }
    val host = parseHost(hostText) ?: return null

    var pathEnd = 0
    while (pathEnd < tail.length && tail[pathEnd] != '?' && tail[pathEnd] != '#') pathEnd++
    val path = parsePath(tail.substring(0, pathEnd))
    var query: String? = null
    var fragment: String? = null
    var p = pathEnd
    if (p < tail.length && tail[p] == '?') {
        var q = p + 1
        while (q < tail.length && tail[q] != '#') q++
        query = encode(tail.substring(p + 1, q), ::inQuerySet)
        p = q
    }
    if (p < tail.length && tail[p] == '#') fragment = encode(tail.substring(p + 1), ::inFragmentSet)
    return "$scheme://$host$port$path" + (query?.let { "?$it" } ?: "") + (fragment?.let { "#$it" } ?: "")
}
