package com.dogtracker

import android.content.Context
import android.os.SystemClock
import android.widget.FrameLayout
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.mlkit.vision.MlKitAnalyzer
import androidx.camera.view.LifecycleCameraController
import androidx.camera.view.PreviewView
import androidx.lifecycle.LifecycleOwner
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.uimanager.SimpleViewManager
import com.facebook.react.uimanager.ThemedReactContext
import com.facebook.react.uimanager.UIManagerHelper
import com.facebook.react.uimanager.annotations.ReactProp
import com.facebook.react.uimanager.events.Event
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.BarcodeScanning
import com.google.mlkit.vision.barcode.common.Barcode
import java.util.concurrent.Executors

/**
 * The camera inside D3a's scan frame (v3 「引導 D3 掃描框」): a back-camera
 * preview that reads QR codes with ML Kit and reports each one as `onScan`
 * ({ value }). The page draws the frame, corners and words around it; the
 * camera permission is asked by the page before this view is shown. While
 * `paused` (a dialog is open, a connection runs) nothing is reported. The
 * same code is not reported again within REPEAT_MS, so a QR code held in
 * front of the camera does not fire again and again.
 */
class QrCameraViewManager : SimpleViewManager<QrCameraViewManager.QrCameraView>() {
  override fun getName() = "QrCameraView"

  override fun createViewInstance(context: ThemedReactContext) = QrCameraView(context)

  @ReactProp(name = "paused")
  fun setPaused(view: QrCameraView, paused: Boolean) {
    view.paused = paused
  }

  override fun onDropViewInstance(view: QrCameraView) {
    view.stop()
    super.onDropViewInstance(view)
  }

  override fun getExportedCustomDirectEventTypeConstants(): Map<String, Any> =
    mapOf(ScanEvent.NAME to mapOf("registrationName" to "onScan"))

  class ScanEvent(surfaceId: Int, viewId: Int, private val value: String) : Event<ScanEvent>(surfaceId, viewId) {
    companion object { const val NAME = "topScan" }
    override fun getEventName() = NAME
    override fun getEventData(): WritableMap = Arguments.createMap().apply { putString("value", value) }
  }

  class QrCameraView(context: Context) : FrameLayout(context) {
    companion object {
      private const val REPEAT_MS = 2500L
      private val analysisExecutor = Executors.newSingleThreadExecutor()
    }

    @Volatile var paused = false
    private val preview = PreviewView(context).apply {
      scaleType = PreviewView.ScaleType.FILL_CENTER
      implementationMode = PreviewView.ImplementationMode.COMPATIBLE
    }
    private val scanner = BarcodeScanning.getClient(
      BarcodeScannerOptions.Builder().setBarcodeFormats(Barcode.FORMAT_QR_CODE).build(),
    )
    private var controller: LifecycleCameraController? = null
    private var lastValue: String? = null
    private var lastAt = 0L

    init {
      addView(preview, LayoutParams(LayoutParams.MATCH_PARENT, LayoutParams.MATCH_PARENT))
    }

    // React sets this view's frame but never measures a native child: the
    // preview is measured and placed here to fill the frame.
    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
      val width = right - left
      val height = bottom - top
      preview.measure(MeasureSpec.makeMeasureSpec(width, MeasureSpec.EXACTLY),
        MeasureSpec.makeMeasureSpec(height, MeasureSpec.EXACTLY))
      preview.layout(0, 0, width, height)
    }

    // The preview asks for a layout when its picture starts; React would not
    // pass that on, so it is done here.
    override fun requestLayout() {
      super.requestLayout()
      post { if (width > 0 && height > 0) onLayout(true, left, top, right, bottom) }
    }

    override fun onAttachedToWindow() {
      super.onAttachedToWindow()
      start()
    }

    override fun onDetachedFromWindow() {
      stop()
      super.onDetachedFromWindow()
    }

    private fun owner(): LifecycleOwner? = ((context as? ReactContext)?.currentActivity ?: context) as? LifecycleOwner

    private fun start() {
      if (controller != null) return
      val lifecycleOwner = owner() ?: return
      val camera = try {
        LifecycleCameraController(context).apply {
          cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA
          setEnabledUseCases(LifecycleCameraController.IMAGE_ANALYSIS)
          setImageAnalysisAnalyzer(analysisExecutor, MlKitAnalyzer(listOf(scanner),
            ImageAnalysis.COORDINATE_SYSTEM_VIEW_REFERENCED, analysisExecutor) { result ->
            val value = result?.getValue(scanner).orEmpty().firstOrNull { !it.rawValue.isNullOrBlank() }?.rawValue
            if (value != null) post { report(value) }
          })
          bindToLifecycle(lifecycleOwner)
        }
      } catch (_: Exception) {
        // No camera (or it is busy): the frame stays dark; 手動輸入 still works.
        null
      }
      controller = camera
      preview.controller = camera
    }

    fun stop() {
      controller?.unbind()
      controller = null
      preview.controller = null
    }

    private fun report(value: String) {
      if (paused) return
      val now = SystemClock.elapsedRealtime()
      if (value == lastValue && now - lastAt < REPEAT_MS) return
      lastValue = value
      lastAt = now
      val reactContext = context as? ReactContext ?: return
      UIManagerHelper.getEventDispatcherForReactTag(reactContext, id)
        ?.dispatchEvent(ScanEvent(UIManagerHelper.getSurfaceId(reactContext), id, value))
    }
  }
}
