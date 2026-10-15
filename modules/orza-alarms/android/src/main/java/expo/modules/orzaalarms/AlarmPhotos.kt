package expo.modules.orzaalarms

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.net.Uri
import android.util.Log
import java.io.File

/**
 * Medicine photos for the alarm notification: decoded safely (bounds first, power-of-two subsampling, OOM caught —
 * a missing or broken photo never stops an alarm), then a BigPicture (one photo, or a strip of up to four — one per
 * medicine) and a square thumbnail for the large icon.
 */
internal object AlarmPhotos {
  private const val MAX_PHOTOS = 4
  private const val SINGLE_MAX_SIDE = 1024
  private const val CELL_SOURCE_MAX_SIDE = 768
  private const val STRIP_WIDTH = 1024
  private const val STRIP_HEIGHT = 512
  private const val STRIP_GAP = 6
  private const val THUMB_SIZE = 256

  class Result(val picture: Bitmap, val thumbnail: Bitmap)

  fun load(uris: List<String>): Result? {
    val wanted = uris.take(MAX_PHOTOS)
    if (wanted.isEmpty()) return null
    val maxSide = if (wanted.size == 1) SINGLE_MAX_SIDE else CELL_SOURCE_MAX_SIDE
    val bitmaps = wanted.mapNotNull { decode(it, maxSide) }
    if (bitmaps.isEmpty()) return null
    return try {
      val picture = if (bitmaps.size == 1) bitmaps[0] else strip(bitmaps)
      Result(picture, thumbnail(bitmaps[0]))
    } catch (e: OutOfMemoryError) {
      Log.w(AlarmConst.TAG, "Out of memory composing the alarm photos")
      null
    } catch (e: Exception) {
      Log.w(AlarmConst.TAG, "Couldn't compose the alarm photos", e)
      null
    }
  }

  private fun decode(uri: String, maxSide: Int): Bitmap? {
    return try {
      val path = (if (uri.startsWith("file:")) Uri.parse(uri).path else uri) ?: return null
      if (!File(path).isFile) return null
      val bounds = BitmapFactory.Options()
      bounds.inJustDecodeBounds = true
      BitmapFactory.decodeFile(path, bounds)
      val w = bounds.outWidth
      val h = bounds.outHeight
      if (w <= 0 || h <= 0) return null
      var sample = 1
      while (Math.max(w, h) / (sample * 2) >= maxSide) sample *= 2
      val opts = BitmapFactory.Options()
      opts.inSampleSize = sample
      opts.inPreferredConfig = Bitmap.Config.ARGB_8888
      val decoded = BitmapFactory.decodeFile(path, opts) ?: return null
      val longest = Math.max(decoded.width, decoded.height)
      if (longest <= maxSide) {
        decoded
      } else {
        val scale = maxSide.toFloat() / longest
        val scaled = Bitmap.createScaledBitmap(
          decoded,
          Math.max(1, Math.round(decoded.width * scale)),
          Math.max(1, Math.round(decoded.height * scale)),
          true
        )
        if (scaled !== decoded) decoded.recycle()
        scaled
      }
    } catch (e: OutOfMemoryError) {
      Log.w(AlarmConst.TAG, "Out of memory decoding an alarm photo")
      null
    } catch (e: Exception) {
      Log.w(AlarmConst.TAG, "Couldn't decode an alarm photo", e)
      null
    }
  }

  /** Photos side by side on a 2:1 canvas, each centre-cropped into its cell. */
  private fun strip(photos: List<Bitmap>): Bitmap {
    val out = Bitmap.createBitmap(STRIP_WIDTH, STRIP_HEIGHT, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(out)
    canvas.drawColor(Color.WHITE)
    val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
    val n = photos.size
    val cellWidth = (STRIP_WIDTH - STRIP_GAP * (n - 1)) / n
    for (i in 0 until n) {
      val bmp = photos[i]
      val left = i * (cellWidth + STRIP_GAP)
      val dst = Rect(left, 0, left + cellWidth, STRIP_HEIGHT)
      canvas.drawBitmap(bmp, centerCrop(bmp.width, bmp.height, cellWidth, STRIP_HEIGHT), dst, paint)
    }
    return out
  }

  private fun thumbnail(photo: Bitmap): Bitmap {
    val out = Bitmap.createBitmap(THUMB_SIZE, THUMB_SIZE, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(out)
    val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
    canvas.drawBitmap(photo, centerCrop(photo.width, photo.height, THUMB_SIZE, THUMB_SIZE), Rect(0, 0, THUMB_SIZE, THUMB_SIZE), paint)
    return out
  }

  /** The source rectangle that fills a `dw`×`dh` cell without distortion. */
  private fun centerCrop(sw: Int, sh: Int, dw: Int, dh: Int): Rect {
    val srcRatio = sw.toFloat() / sh
    val dstRatio = dw.toFloat() / dh
    return if (srcRatio > dstRatio) {
      val cropWidth = Math.max(1, Math.round(sh * dstRatio))
      val x = (sw - cropWidth) / 2
      Rect(x, 0, x + cropWidth, sh)
    } else {
      val cropHeight = Math.max(1, Math.round(sw / dstRatio))
      val y = (sh - cropHeight) / 2
      Rect(0, y, sw, y + cropHeight)
    }
  }
}
