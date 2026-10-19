package expo.modules.orzaalarms

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.Rect
import android.net.Uri
import android.util.Log
import java.io.File

/**
 * Medicine photos for the alarm notification: decoded safely (bounds first, power-of-two subsampling, OOM caught —
 * a missing or broken photo never stops an alarm), then composed into ONE BigPicture on a 16:9 canvas (Android shows
 * a big picture at most ~284 dp tall and centre-crops anything taller, which would cut a portrait photo of a pack —
 * and the medicine's name — in half): a single photo is fitted whole; several (one per medicine, up to four) sit side
 * by side, each filling its cell unless that would crop away more than a quarter of it, then fitted whole instead.
 * Plus a square thumbnail of the first photo for the large icon.
 */
internal object AlarmPhotos {
  private const val MAX_PHOTOS = 4
  private const val SINGLE_MAX_SIDE = 1024
  private const val CELL_SOURCE_MAX_SIDE = 768
  private const val CANVAS_WIDTH = 1024
  private const val CANVAS_HEIGHT = 576
  private const val GAP = 6
  private const val THUMB_SIZE = 256

  /** Fill a cell (centre-crop) only while at least this share of the photo stays visible; otherwise fit it whole. */
  private const val MIN_VISIBLE_WHEN_FILLING = 0.75f

  /** Warm off-white behind fitted photos (matches the app's light surfaces). */
  private const val BACKGROUND = 0xFFF6F2EE.toInt()

  class Result(val picture: Bitmap, val thumbnail: Bitmap)

  fun load(uris: List<String>): Result? {
    val wanted = uris.take(MAX_PHOTOS)
    if (wanted.isEmpty()) return null
    val maxSide = if (wanted.size == 1) SINGLE_MAX_SIDE else CELL_SOURCE_MAX_SIDE
    val bitmaps = wanted.mapNotNull { decode(it, maxSide) }
    if (bitmaps.isEmpty()) return null
    return try {
      Result(compose(bitmaps), thumbnail(bitmaps[0]))
    } catch (e: OutOfMemoryError) {
      Log.w(AlarmConst.TAG, "Out of memory composing the alarm photos")
      null
    } catch (e: Exception) {
      Log.w(AlarmConst.TAG, "Couldn't compose the alarm photos", e)
      null
    } finally {
      // The picture and thumbnail are new bitmaps; the decoded sources aren't needed any more.
      for (b in bitmaps) {
        try {
          b.recycle()
        } catch (e: Exception) {
          // Ignore.
        }
      }
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

  /** The photos side by side on a 16:9 canvas. */
  private fun compose(photos: List<Bitmap>): Bitmap {
    val out = Bitmap.createBitmap(CANVAS_WIDTH, CANVAS_HEIGHT, Bitmap.Config.ARGB_8888)
    val canvas = Canvas(out)
    canvas.drawColor(BACKGROUND)
    val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
    val n = photos.size
    val cellWidth = (CANVAS_WIDTH - GAP * (n - 1)) / n
    for (i in 0 until n) {
      val bmp = photos[i]
      val left = i * (cellWidth + GAP)
      val cell = Rect(left, 0, left + cellWidth, CANVAS_HEIGHT)
      val crop = centerCrop(bmp.width, bmp.height, cell.width(), cell.height())
      val visible = (crop.width().toFloat() * crop.height()) / (bmp.width.toFloat() * bmp.height)
      if (n > 1 && visible >= MIN_VISIBLE_WHEN_FILLING) {
        canvas.drawBitmap(bmp, crop, cell, paint)
      } else {
        canvas.drawBitmap(bmp, null, fitInside(bmp.width, bmp.height, cell), paint)
      }
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
      val cropWidth = Math.min(sw, Math.max(1, Math.round(sh * dstRatio)))
      val x = (sw - cropWidth) / 2
      Rect(x, 0, x + cropWidth, sh)
    } else {
      val cropHeight = Math.min(sh, Math.max(1, Math.round(sw / dstRatio)))
      val y = (sh - cropHeight) / 2
      Rect(0, y, sw, y + cropHeight)
    }
  }

  /** The largest rectangle with the photo's proportions centred inside `cell` (the whole photo stays visible). */
  private fun fitInside(sw: Int, sh: Int, cell: Rect): Rect {
    val scale = Math.min(cell.width().toFloat() / sw, cell.height().toFloat() / sh)
    val w = Math.max(1, Math.round(sw * scale))
    val h = Math.max(1, Math.round(sh * scale))
    val x = cell.left + (cell.width() - w) / 2
    val y = cell.top + (cell.height() - h) / 2
    return Rect(x, y, x + w, y + h)
  }
}
