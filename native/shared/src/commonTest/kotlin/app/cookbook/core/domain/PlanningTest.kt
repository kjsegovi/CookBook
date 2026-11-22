package app.cookbook.core.domain

import kotlin.test.Test
import kotlin.test.assertEquals

class PlanningTest {
    @Test fun keywordAisles() {
        assertEquals("Frozen", keywordAisle("frozen peas"))
        assertEquals("Canned & Jarred", keywordAisle("tomato paste"))
        assertEquals("Other", keywordAisle("mystery"))
    }

    @Test fun aisleOrderSorts() {
        val order = aisleOrder(listOf("Dairy & Eggs", "Produce"))
        assertEquals(listOf("Dairy & Eggs", "Produce", "Other"), listOf("Produce", "Other", "Dairy & Eggs").sortedBy(order))
    }
}
