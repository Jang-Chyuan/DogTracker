package com.dogtracker

import org.junit.Assert.*
import org.junit.Test

class ExportLabelLayoutTest {
  private val w = 1080
  private val h = 1200

  @Test fun scaleIsARoundLength() {
    val scale = ExportLabelLayout.scale(0.25)!!
    assertEquals(50.0, scale.metres, 1e-9)
    assertEquals(200f, scale.lengthPx, 1e-3f)
    assertEquals("50 m", scale.label)
    assertEquals("2 km", ExportLabelLayout.scale(10.0)!!.label)
    assertNull(ExportLabelLayout.scale(Double.NaN))
  }

  // O3 (lane C, 061c/061d): a start time right above the scale bar drew its
  // label (under the ring) across 「50 m」.
  @Test fun aTimeLabelMovesOffTheScaleBar() {
    val scaleBox = ExportLabelLayout.scaleBox(h, 200f, 60f)
    val px = 120f
    val py = ExportLabelLayout.scaleBottom(h) - 110f
    val options = ExportLabelLayout.timeLabelOptions(px, py, 20f, 70f)
    assertTrue("the old first choice covered the scale", options[0].intersects(scaleBox))
    val box = ExportLabelLayout.place(options, listOf(scaleBox), emptyList())
    assertFalse(box!!.intersects(scaleBox))
    assertEquals(options[1], box)
  }

  @Test fun aTimeLabelMovesOffTheNorthArrowAndAttribution() {
    val north = ExportLabelLayout.northBox(w)
    val near = ExportLabelLayout.timeLabelOptions(w - 72f, 140f, 15f, 70f)
    assertFalse(ExportLabelLayout.place(near, listOf(north), emptyList())!!.intersects(north))
    val attribution = ExportLabelLayout.attributionBox(w, h, 120f)
    val low = ExportLabelLayout.timeLabelOptions(w - 90f, h - 110f, 15f, 70f)
    assertFalse(ExportLabelLayout.place(low, listOf(attribution), emptyList())!!.intersects(attribution))
  }

  @Test fun labelsStillAvoidEachOtherAndNumbers() {
    val number = LabelBox(467f, 540f, 533f, 606f)
    val options = ExportLabelLayout.timeLabelOptions(500f, 500f, 15f, 60f)
    val first = ExportLabelLayout.place(options, emptyList(), listOf(number))
    assertEquals(options[1], first)
    val second = ExportLabelLayout.place(options, emptyList(), listOf(number, first!!))
    if (second != null) {
      assertNotEquals(first, second)
      assertFalse(second.intersects(number))
    }
  }

  @Test fun whenEveryPlaceCollidesTheLabelIsLeftOut() {
    val options = ExportLabelLayout.timeLabelOptions(500f, 500f, 15f, 60f)
    assertNull(ExportLabelLayout.place(options, options.take(3), listOf(options[3])))
  }

  @Test fun nothingInTheWayKeepsTheFirstPlace() {
    val options = ExportLabelLayout.timeLabelOptions(500f, 500f, 15f, 60f)
    assertEquals(options[0], ExportLabelLayout.place(options, listOf(ExportLabelLayout.northBox(w)), emptyList()))
  }
}
