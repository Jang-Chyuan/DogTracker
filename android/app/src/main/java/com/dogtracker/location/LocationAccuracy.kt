package com.dogtracker.location

internal fun acceptsLocationAccuracy(hasAccuracy: Boolean, meters: Float): Boolean =
  hasAccuracy && meters.isFinite() && meters >= 0f && meters <= 5f
