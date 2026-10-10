package com.dogtracker

import kotlin.math.floor
import kotlin.math.log10
import kotlin.math.max
import kotlin.math.pow

/** A rectangle in the PNG map's pixels (plain floats: unit-testable without android.graphics). */
data class LabelBox(val left: Float, val top: Float, val right: Float, val bottom: Float) {
  val centerX get() = (left + right) / 2f
  val height get() = bottom - top
  fun intersects(other: LabelBox) =
    left < other.right && other.left < right && top < other.bottom && other.top < bottom
}

/**
 * Where the PNG export's map labels go (HistoryExportModule.drawMap). The
 * scale bar (bottom left), the north arrow (top right) and the attribution
 * (bottom right) are fixed; every time label takes the first of its places
 * (under the ring, above, right, left) that covers no number, house, other
 * label or one of those fixed marks — one collision rule for all of them.
 */
object ExportLabelLayout {
  const val SCALE_LEFT = 32f
  const val SCALE_BOTTOM_INSET = 120f
  const val SCALE_MAX_PX = 240f
  const val SCALE_TEXT_SIZE = 30f
  const val NORTH_INSET = 72f
  const val NORTH_RADIUS = 40f
  const val ATTRIBUTION_RIGHT_INSET = 24f
  const val ATTRIBUTION_TOP_INSET = 56f
  const val ATTRIBUTION_HEIGHT = 40f
  const val ATTRIBUTION_TEXT_SIZE = 26f
  // Clear space kept around the fixed marks (the label halo is ~10px).
  private const val MARGIN = 8f

  data class Scale(val metres: Double, val lengthPx: Float, val label: String)

  /** 比例尺: a round length (1, 2 or 5 × 10ⁿ m) up to 240px; null without a usable projection. */
  fun scale(metresPerPixel: Double): Scale? {
    val maxMetres = metresPerPixel * SCALE_MAX_PX
    if (!maxMetres.isFinite() || maxMetres <= 0) return null
    val power = 10.0.pow(floor(log10(maxMetres)))
    val metres = listOf(5.0, 2.0, 1.0).map { it * power }.firstOrNull { it <= maxMetres * 1.0001 } ?: power
    val label = if (metres >= 1000) {
      val km = metres / 1000
      "${if (km % 1.0 == 0.0) km.toInt().toString() else km.toString()} km"
    } else "${metres.toInt()} m"
    return Scale(metres, (metres / metresPerPixel).toFloat(), label)
  }

  /** The bar's baseline y (its ticks rise 14px above it; the label's 40px line box ends 16px above it). */
  fun scaleBottom(h: Int) = h - SCALE_BOTTOM_INSET

  /** The scale bar and its label, with their halo. */
  fun scaleBox(h: Int, lengthPx: Float, labelWidth: Float): LabelBox {
    val bottom = scaleBottom(h)
    return LabelBox(SCALE_LEFT - MARGIN, bottom - 56f - MARGIN,
      SCALE_LEFT + max(lengthPx, labelWidth) + MARGIN, bottom + MARGIN)
  }

  fun northBox(w: Int) = LabelBox(w - NORTH_INSET - NORTH_RADIUS - MARGIN, NORTH_INSET - NORTH_RADIUS - MARGIN,
    w - NORTH_INSET + NORTH_RADIUS + MARGIN, NORTH_INSET + NORTH_RADIUS + MARGIN)

  fun attributionBox(w: Int, h: Int, textWidth: Float): LabelBox {
    val right = w - ATTRIBUTION_RIGHT_INSET
    val top = h - ATTRIBUTION_TOP_INSET
    return LabelBox(right - textWidth - MARGIN, top - MARGIN, right + MARGIN, top + ATTRIBUTION_HEIGHT + MARGIN)
  }

  /** A time label's places around its ring (radius r) at (px, py): under, above, right, left. */
  fun timeLabelOptions(px: Float, py: Float, r: Float, halfWidth: Float) = listOf(
    LabelBox(px - halfWidth, py + r + 4f, px + halfWidth, py + r + 48f),
    LabelBox(px - halfWidth, py - r - 48f, px + halfWidth, py - r - 4f),
    LabelBox(px + r + 6f, py - 22f, px + r + 6f + 2 * halfWidth, py + 22f),
    LabelBox(px - r - 6f - 2 * halfWidth, py - 22f, px - r - 6f, py + 22f))

  /**
   * The first option that covers nothing in `fixed` (scale, north, attribution)
   * or `taken` (numbers, houses, labels placed before); null when every option
   * collides — the label is then left out (its ring stays), never drawn over
   * another label, a number or the scale bar.
   */
  fun place(options: List<LabelBox>, fixed: List<LabelBox>, taken: List<LabelBox>): LabelBox? =
    options.firstOrNull { option -> fixed.none { it.intersects(option) } && taken.none { it.intersects(option) } }
}
