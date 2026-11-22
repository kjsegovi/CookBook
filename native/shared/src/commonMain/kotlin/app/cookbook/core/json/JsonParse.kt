package app.cookbook.core.json

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement

/**
 * `JSON.parse(text)`: accepts exactly the JSON grammar (RFC 8259) and throws [IllegalArgumentException] otherwise.
 * kotlinx's parser is looser (it reads unquoted literals such as `01` or `tru`), so the text is checked first.
 */
fun jsonParse(text: String): JsonElement {
    StrictJson(text).validate()
    return Json.parseToJsonElement(text)
}

private class StrictJson(private val s: String) {
    private var i = 0

    fun validate() {
        space()
        value()
        space()
        if (i != s.length) fail()
    }

    private fun fail(): Nothing = throw IllegalArgumentException("Unexpected token at position $i in JSON")

    private fun space() {
        while (i < s.length && (s[i] == ' ' || s[i] == '\t' || s[i] == '\n' || s[i] == '\r')) i++
    }

    private fun peek(): Char = if (i < s.length) s[i] else fail()

    private fun value() {
        when (peek()) {
            '{' -> obj()
            '[' -> array()
            '"' -> string()
            't' -> literal("true")
            'f' -> literal("false")
            'n' -> literal("null")
            else -> number()
        }
    }

    private fun literal(word: String) {
        if (!s.startsWith(word, i)) fail()
        i += word.length
    }

    private fun obj() {
        i++
        space()
        if (peek() == '}') { i++; return }
        while (true) {
            space()
            if (peek() != '"') fail()
            string()
            space()
            if (peek() != ':') fail()
            i++
            space()
            value()
            space()
            when (peek()) {
                ',' -> i++
                '}' -> { i++; return }
                else -> fail()
            }
        }
    }

    private fun array() {
        i++
        space()
        if (peek() == ']') { i++; return }
        while (true) {
            space()
            value()
            space()
            when (peek()) {
                ',' -> i++
                ']' -> { i++; return }
                else -> fail()
            }
        }
    }

    private fun string() {
        i++
        while (true) {
            val c = peek()
            when {
                c == '"' -> { i++; return }
                c < ' ' -> fail()
                c == '\\' -> {
                    i++
                    when (peek()) {
                        '"', '\\', '/', 'b', 'f', 'n', 'r', 't' -> i++
                        'u' -> {
                            i++
                            repeat(4) { if (!peek().isHex()) fail(); i++ }
                        }
                        else -> fail()
                    }
                }
                else -> i++
            }
        }
    }

    private fun Char.isHex() = this in '0'..'9' || this in 'a'..'f' || this in 'A'..'F'

    private fun digits(): Int {
        val start = i
        while (i < s.length && s[i] in '0'..'9') i++
        return i - start
    }

    private fun number() {
        if (peek() == '-') i++
        when {
            peek() == '0' -> i++
            peek() in '1'..'9' -> digits()
            else -> fail()
        }
        if (i < s.length && s[i] == '.') {
            i++
            if (digits() == 0) fail()
        }
        if (i < s.length && (s[i] == 'e' || s[i] == 'E')) {
            i++
            if (i < s.length && (s[i] == '+' || s[i] == '-')) i++
            if (digits() == 0) fail()
        }
    }
}
