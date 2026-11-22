package app.cookbook.core.json

import kotlinx.serialization.KSerializer
import kotlinx.serialization.SerializationException
import kotlinx.serialization.descriptors.SerialDescriptor
import kotlinx.serialization.encoding.Decoder
import kotlinx.serialization.encoding.Encoder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonDecoder
import kotlinx.serialization.json.JsonEncoder
import kotlinx.serialization.json.JsonObject

const val EXTRA_KEY = "extra"

/**
 * Wraps a generated serializer for a class that has a `extra: JsonObject` property.
 * Decoding moves keys the class does not declare into `extra`; encoding merges them back
 * as top-level keys, so records written by a newer client survive a round trip.
 */
open class PreservingSerializer<T>(private val base: KSerializer<T>) : KSerializer<T> {
    override val descriptor: SerialDescriptor = base.descriptor
    private val known: Set<String> =
        (0 until descriptor.elementsCount).map { descriptor.getElementName(it) }.filter { it != EXTRA_KEY }.toSet()

    override fun deserialize(decoder: Decoder): T {
        val jsonDecoder = decoder as? JsonDecoder ?: throw SerializationException("PreservingSerializer needs JSON")
        val source = jsonDecoder.decodeJsonElement() as? JsonObject ?: throw SerializationException("Expected a JSON object")
        val declared = source.filterKeys { it in known }
        val unknown = source.filterKeys { it !in known }
        return jsonDecoder.json.decodeFromJsonElement(base, JsonObject(declared + (EXTRA_KEY to JsonObject(unknown))))
    }

    override fun serialize(encoder: Encoder, value: T) {
        val jsonEncoder = encoder as? JsonEncoder ?: throw SerializationException("PreservingSerializer needs JSON")
        val encoded = jsonEncoder.json.encodeToJsonElement(base, value) as JsonObject
        val extra = encoded[EXTRA_KEY] as? JsonObject ?: JsonObject(emptyMap())
        val declared = encoded.filterKeys { it != EXTRA_KEY }
        // Declared fields win over a stray extra key of the same name.
        jsonEncoder.encodeJsonElement(JsonObject(extra.filterKeys { it !in declared } + declared))
    }
}

val CookbookJson: Json = Json {
    ignoreUnknownKeys = false
    explicitNulls = true
    encodeDefaults = true
}
