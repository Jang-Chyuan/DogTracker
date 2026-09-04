package com.dogtracker

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.RectF
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.Gravity
import android.view.ViewGroup
import android.widget.Button
import android.widget.FrameLayout
import android.widget.TextView
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageAnalysis
import androidx.camera.mlkit.vision.MlKitAnalyzer
import androidx.camera.view.LifecycleCameraController
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import com.google.mlkit.vision.barcode.BarcodeScannerOptions
import com.google.mlkit.vision.barcode.common.Barcode
import com.google.mlkit.vision.barcode.BarcodeScanning
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean

class QrScannerActivity : AppCompatActivity() {
  companion object {
    const val EXTRA_RESULT = "qrResult"
    const val RESULT_PERMISSION_DENIED = Activity.RESULT_FIRST_USER + 1
    private val analysisExecutor = Executors.newSingleThreadExecutor()
  }

  private val mainHandler = Handler(Looper.getMainLooper())
  private val completed = AtomicBoolean(false)
  private val scanner by lazy {
    BarcodeScanning.getClient(
      BarcodeScannerOptions.Builder()
        .setBarcodeFormats(Barcode.FORMAT_QR_CODE)
        .build(),
    )
  }
  private lateinit var previewView: PreviewView
  private lateinit var scanFrame: ScanFrameView
  private lateinit var hint: TextView

  private val permissionLauncher = registerForActivityResult(
    ActivityResultContracts.RequestPermission(),
  ) { granted ->
    if (granted) startCamera() else {
      setResult(RESULT_PERMISSION_DENIED)
      finish()
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    buildUi()
    if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
      startCamera()
    } else {
      permissionLauncher.launch(Manifest.permission.CAMERA)
    }
  }

  private fun buildUi() {
    val root = FrameLayout(this).apply { setBackgroundColor(Color.BLACK) }
    previewView = PreviewView(this).apply {
      scaleType = PreviewView.ScaleType.FILL_CENTER
      implementationMode = PreviewView.ImplementationMode.COMPATIBLE
    }
    root.addView(previewView, FrameLayout.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT,
    ))

    scanFrame = ScanFrameView(this)
    root.addView(scanFrame, FrameLayout.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.MATCH_PARENT,
    ))

    hint = TextView(this).apply {
      text = "將 DogTracker Master QR Code 對準畫面"
      setTextColor(Color.WHITE)
      setBackgroundColor(0x99000000.toInt())
      textSize = 17f
      gravity = Gravity.CENTER
      setPadding(24, 20, 24, 20)
    }
    root.addView(hint, FrameLayout.LayoutParams(
      ViewGroup.LayoutParams.MATCH_PARENT,
      ViewGroup.LayoutParams.WRAP_CONTENT,
      Gravity.TOP,
    ).apply { topMargin = 48 })

    val cancel = Button(this).apply {
      text = "取消"
      setOnClickListener { cancelScan() }
    }
    root.addView(cancel, FrameLayout.LayoutParams(
      ViewGroup.LayoutParams.WRAP_CONTENT,
      ViewGroup.LayoutParams.WRAP_CONTENT,
      Gravity.BOTTOM or Gravity.CENTER_HORIZONTAL,
    ).apply { bottomMargin = 56 })
    setContentView(root)
  }

  private fun startCamera() {
    val controller = LifecycleCameraController(this).apply {
      cameraSelector = CameraSelector.DEFAULT_BACK_CAMERA
      setEnabledUseCases(LifecycleCameraController.IMAGE_ANALYSIS)
      setImageAnalysisAnalyzer(
        analysisExecutor,
        MlKitAnalyzer(
          listOf(scanner),
          ImageAnalysis.COORDINATE_SYSTEM_VIEW_REFERENCED,
          analysisExecutor,
        ) { result ->
          if (completed.get()) return@MlKitAnalyzer
          val barcodes = result?.getValue(scanner).orEmpty()
          val barcode = barcodes.firstOrNull { !it.rawValue.isNullOrBlank() }
          val bounds = barcode?.boundingBox
          runOnUiThread {
            scanFrame.setDetectedBounds(bounds?.let(::RectF))
            val value = barcode?.rawValue
            if (value != null && completed.compareAndSet(false, true)) {
              setResult(Activity.RESULT_OK, Intent().putExtra(EXTRA_RESULT, value))
              scanFrame.showSuccess()
              hint.text = "掃描成功，正在驗證…"
              hint.setBackgroundColor(0xCC166534.toInt())
              mainHandler.postDelayed({ finish() }, 700)
            }
          }
        },
      )
      bindToLifecycle(this@QrScannerActivity)
    }
    previewView.controller = controller
  }

  private fun cancelScan() {
    if (completed.compareAndSet(false, true)) setResult(Activity.RESULT_CANCELED)
    finish()
  }

  override fun onBackPressed() = cancelScan()

  override fun onDestroy() {
    mainHandler.removeCallbacksAndMessages(null)
    scanner.close()
    super.onDestroy()
  }

  private class ScanFrameView(context: android.content.Context) : android.view.View(context) {
    private val overlayPaint = Paint().apply { color = 0x66000000 }
    private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = Color.WHITE
      style = Paint.Style.STROKE
      strokeWidth = 5f
    }
    private val cornerPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
      color = 0xFF60A5FA.toInt()
      style = Paint.Style.STROKE
      strokeWidth = 12f
      strokeCap = Paint.Cap.SQUARE
    }
    private var success = false
    private var detectedBounds: RectF? = null

    fun setDetectedBounds(bounds: RectF?) {
      detectedBounds = bounds
      invalidate()
    }

    fun showSuccess() {
      success = true
      invalidate()
    }

    override fun onDraw(canvas: Canvas) {
      super.onDraw(canvas)
      val size = minOf(width * 0.76f, height * 0.42f)
      val left = (width - size) / 2f
      val top = (height - size) / 2f
      val guideFrame = RectF(left, top, left + size, top + size)
      val frame = detectedBounds?.let { detected ->
        RectF(
          detected.left.coerceIn(0f, width.toFloat()),
          detected.top.coerceIn(0f, height.toFloat()),
          detected.right.coerceIn(0f, width.toFloat()),
          detected.bottom.coerceIn(0f, height.toFloat()),
        )
      } ?: guideFrame

      canvas.drawRect(0f, 0f, width.toFloat(), top, overlayPaint)
      canvas.drawRect(0f, frame.bottom, width.toFloat(), height.toFloat(), overlayPaint)
      canvas.drawRect(0f, top, left, frame.bottom, overlayPaint)
      canvas.drawRect(frame.right, top, width.toFloat(), frame.bottom, overlayPaint)

      borderPaint.color = when {
        success -> 0xFF4ADE80.toInt()
        detectedBounds != null -> 0xFFFACC15.toInt()
        else -> Color.WHITE
      }
      cornerPaint.color = when {
        success -> 0xFF22C55E.toInt()
        detectedBounds != null -> 0xFFEAB308.toInt()
        else -> 0xFF60A5FA.toInt()
      }
      canvas.drawRoundRect(frame, 24f, 24f, borderPaint)

      val corner = size * 0.16f
      canvas.drawLine(left, top + corner, left, top, cornerPaint)
      canvas.drawLine(left, top, left + corner, top, cornerPaint)
      canvas.drawLine(frame.right - corner, top, frame.right, top, cornerPaint)
      canvas.drawLine(frame.right, top, frame.right, top + corner, cornerPaint)
      canvas.drawLine(left, frame.bottom - corner, left, frame.bottom, cornerPaint)
      canvas.drawLine(left, frame.bottom, left + corner, frame.bottom, cornerPaint)
      canvas.drawLine(frame.right - corner, frame.bottom, frame.right, frame.bottom, cornerPaint)
      canvas.drawLine(frame.right, frame.bottom - corner, frame.right, frame.bottom, cornerPaint)
    }
  }
}
