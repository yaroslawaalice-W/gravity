(function () {
  'use strict';

  var stage = document.getElementById('stage');
  var canvas = document.getElementById('gravity-canvas');
  var ctx = canvas.getContext('2d');
  var emptyState = document.getElementById('empty-state');
  var emptyUploadBtn = document.getElementById('empty-upload-btn');
  var fileInput = document.getElementById('file-input');
  var uploadBtn = document.getElementById('upload-btn');
  var collageBtn = document.getElementById('collage-btn');
  var saveImageBtn = document.getElementById('save-image-btn');
  var videoBtn = document.getElementById('video-btn');
  var resetBtn = document.getElementById('reset-btn');
  var modeToggle = document.getElementById('mode-toggle');

  var mode = 'cut'; // 'cut' | 'duplicate'
  var collageMode = false;
  var mediaRecorder = null;
  var recordedChunks = [];
  var isRecording = false;
  var viewWidth = 0;
  var viewHeight = 0;
  var dpr = window.devicePixelRatio || 1;

  var originalImage = null;
  var sourceImage = null;
  var baseCanvas = document.createElement('canvas');
  var baseCtx = baseCanvas.getContext('2d');
  var imageRect = null;

  var pieces = [];
  var nextPieceId = 1;

  var isDrawing = false;
  var draggedPiece = null;
  var dragOffset = { x: 0, y: 0 };
  var activePointerId = null;
  var activePath = [];
  var lastFrameTime = performance.now();

  function resizeCanvas() {
    var rect = stage.getBoundingClientRect();
    var nextW = Math.max(1, rect.width);
    var nextH = Math.max(1, rect.height);
    var sizeChanged = viewWidth > 0 && viewHeight > 0 && (Math.abs(nextW - viewWidth) > 1 || Math.abs(nextH - viewHeight) > 1);

    viewWidth = nextW;
    viewHeight = nextH;
    dpr = window.devicePixelRatio || 1;

    canvas.width = Math.round(viewWidth * dpr);
    canvas.height = Math.round(viewHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    if (sizeChanged && pieces.length > 0) {
      GravityPhysics.triggerHalfDrop(pieces);
    }

    updateImageRect();
  }

  function updateImageRect() {
    if (!sourceImage) {
      imageRect = null;
      return;
    }
    var topPadding = viewWidth <= 640 ? 108 : 72;
    var sidePadding = viewWidth <= 640 ? 16 : 28;
    var availH = Math.max(80, viewHeight - topPadding - 24);
    var fitted = GravityGeometry.fitImageRect(
      sourceImage.naturalWidth,
      sourceImage.naturalHeight,
      viewWidth,
      availH,
      sidePadding
    );
    imageRect = {
      x: fitted.x,
      y: fitted.y + topPadding * 0.72,
      width: fitted.width,
      height: fitted.height
    };
  }

  function resetBaseImage() {
    if (!originalImage) return;
    sourceImage = originalImage;
    baseCanvas.width = sourceImage.naturalWidth;
    baseCanvas.height = sourceImage.naturalHeight;
    baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
    baseCtx.drawImage(sourceImage, 0, 0);
    pieces = [];
    activePath = [];
    isDrawing = false;
    updateImageRect();
  }

  function loadImageFile(file) {
    if (!file || !file.type || file.type.indexOf('image/') !== 0) {
      return;
    }
    var reader = new FileReader();
    reader.onload = function (ev) {
      var img = new Image();
      img.onload = function () {
        originalImage = img;
        resetBaseImage();
        emptyState.classList.add('hidden');
        canvas.classList.add('can-draw');
        collageBtn.disabled = false;
        saveImageBtn.disabled = false;
        videoBtn.disabled = !(canvas.captureStream && typeof MediaRecorder !== 'undefined');
        resetBtn.disabled = false;
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  }

  function saveImage() {
    if (!sourceImage) return;

    var snapCanvas = document.createElement('canvas');
    snapCanvas.width = Math.round(viewWidth * dpr);
    snapCanvas.height = Math.round(viewHeight * dpr);
    var sCtx = snapCanvas.getContext('2d');
    sCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Composite current black canvas, base image, and all frozen pieces
    sCtx.fillStyle = '#000000';
    sCtx.fillRect(0, 0, viewWidth, viewHeight);

    if (imageRect) {
      sCtx.drawImage(baseCanvas, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
    }

    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i];
      if (!p.canvas) continue;
      sCtx.save();
      sCtx.translate(p.x, p.y);
      sCtx.rotate(p.angle);
      sCtx.shadowColor = 'rgba(0, 0, 0, 0.45)';
      sCtx.shadowBlur = 12;
      sCtx.drawImage(p.canvas, -p.offsetX, -p.offsetY, p.width, p.height);
      sCtx.restore();
    }

    var dataUrl = snapCanvas.toDataURL('image/png');

    // Download photo of current status
    var link = document.createElement('a');
    link.download = 'gravity-image.png';
    link.href = dataUrl;
    link.click();

    // Freeze the saved image as the new background for further cutouts
    var snapImg = new Image();
    snapImg.onload = function () {
      sourceImage = snapImg;
      baseCanvas.width = snapImg.naturalWidth;
      baseCanvas.height = snapImg.naturalHeight;
      baseCtx.clearRect(0, 0, baseCanvas.width, baseCanvas.height);
      baseCtx.drawImage(snapImg, 0, 0);
      pieces = [];
      activePath = [];
      isDrawing = false;
      updateImageRect();
    };
    snapImg.src = dataUrl;
  }

  function getSupportedVideoMimeType() {
    if (typeof MediaRecorder === 'undefined' || !MediaRecorder.isTypeSupported) {
      return '';
    }
    var candidates = [
      'video/mp4',
      'video/webm;codecs=vp9',
      'video/webm;codecs=vp8',
      'video/webm'
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (MediaRecorder.isTypeSupported(candidates[i])) {
        return candidates[i];
      }
    }
    return '';
  }

  function startVideo() {
    if (!canvas.captureStream || typeof MediaRecorder === 'undefined' || isRecording) return;

    var stream = canvas.captureStream(30);
    var mimeType = getSupportedVideoMimeType();
    recordedChunks = [];

    try {
      mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType: mimeType })
        : new MediaRecorder(stream);
    } catch (err) {
      mediaRecorder = new MediaRecorder(stream);
    }

    mediaRecorder.ondataavailable = function (ev) {
      if (ev.data && ev.data.size > 0) {
        recordedChunks.push(ev.data);
      }
    };

    mediaRecorder.onstop = function () {
      var actualMime = (mediaRecorder && mediaRecorder.mimeType) || mimeType || 'video/webm';
      var ext = actualMime.indexOf('mp4') !== -1 ? 'mp4' : 'webm';
      var blob = new Blob(recordedChunks, { type: actualMime });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.download = 'gravity-video.' + ext;
      link.href = url;
      link.click();
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 2000);
      recordedChunks = [];
      isRecording = false;
      videoBtn.textContent = 'Start Video';
      videoBtn.classList.remove('recording');
      videoBtn.setAttribute('aria-pressed', 'false');
    };

    mediaRecorder.start(250);
    isRecording = true;
    videoBtn.textContent = 'Stop Video';
    videoBtn.classList.add('recording');
    videoBtn.setAttribute('aria-pressed', 'true');
  }

  function stopVideo() {
    if (mediaRecorder && isRecording && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
  }

  function getCanvasPoint(clientX, clientY) {
    var rect = canvas.getBoundingClientRect();
    return {
      x: clientX - rect.left,
      y: clientY - rect.top
    };
  }

  function isPointInRect(pt, rect) {
    return (
      rect &&
      pt.x >= rect.x &&
      pt.x <= rect.x + rect.width &&
      pt.y >= rect.y &&
      pt.y <= rect.y + rect.height
    );
  }

  function findPieceAtPoint(pt) {
    for (var i = pieces.length - 1; i >= 0; i--) {
      var p = pieces[i];
      var dx = pt.x - p.x;
      var dy = pt.y - p.y;
      var cos = Math.cos(-p.angle);
      var sin = Math.sin(-p.angle);
      var localX = dx * cos - dy * sin + p.offsetX;
      var localY = dx * sin + dy * cos + p.offsetY;

      if (localX < 0 || localX > p.width || localY < 0 || localY > p.height) {
        continue;
      }

      if (p.canvas) {
        var px = Math.min(p.canvas.width - 1, Math.max(0, Math.floor(localX * dpr)));
        var py = Math.min(p.canvas.height - 1, Math.max(0, Math.floor(localY * dpr)));
        var alpha = p.canvas.getContext('2d').getImageData(px, py, 1, 1).data[3];
        if (alpha > 10) {
          return i;
        }
      } else {
        return i;
      }
    }
    return -1;
  }

  function extractAndSpawnPiece(poly) {
    var bbox = poly.bbox;
    var pieceW = Math.max(1, Math.ceil(bbox.width));
    var pieceH = Math.max(1, Math.ceil(bbox.height));

    var pieceCanvas = document.createElement('canvas');
    pieceCanvas.width = Math.round(pieceW * dpr);
    pieceCanvas.height = Math.round(pieceH * dpr);
    var pCtx = pieceCanvas.getContext('2d');
    pCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Clip to traced polygon relative to bounding box
    pCtx.save();
    pCtx.beginPath();
    for (var i = 0; i < poly.points.length; i++) {
      var px = poly.points[i].x - bbox.x;
      var py = poly.points[i].y - bbox.y;
      if (i === 0) pCtx.moveTo(px, py);
      else pCtx.lineTo(px, py);
    }
    pCtx.closePath();
    pCtx.clip();

    // Draw from baseCanvas without stretching
    var scaleX = baseCanvas.width / imageRect.width;
    var scaleY = baseCanvas.height / imageRect.height;
    var srcX = (bbox.x - imageRect.x) * scaleX;
    var srcY = (bbox.y - imageRect.y) * scaleY;
    var srcW = bbox.width * scaleX;
    var srcH = bbox.height * scaleY;

    pCtx.drawImage(baseCanvas, srcX, srcY, srcW, srcH, 0, 0, bbox.width, bbox.height);
    pCtx.restore();

    // If Cut mode, fill the cutout region on baseCanvas with solid black (#000000)
    if (mode === 'cut') {
      baseCtx.save();
      baseCtx.beginPath();
      for (var j = 0; j < poly.points.length; j++) {
        var bx = (poly.points[j].x - imageRect.x) * scaleX;
        var by = (poly.points[j].y - imageRect.y) * scaleY;
        if (j === 0) baseCtx.moveTo(bx, by);
        else baseCtx.lineTo(bx, by);
      }
      baseCtx.closePath();
      baseCtx.fillStyle = '#000000';
      baseCtx.fill();
      baseCtx.restore();
    }

    var piece = GravityPhysics.createPiece({
      id: nextPieceId++,
      canvas: pieceCanvas,
      x: poly.centroid.x,
      y: poly.centroid.y,
      width: pieceW,
      height: pieceH,
      radius: poly.radius,
      offsetX: poly.centroid.x - bbox.x,
      offsetY: poly.centroid.y - bbox.y
    });
    piece.offsetX = poly.centroid.x - bbox.x;
    piece.offsetY = poly.centroid.y - bbox.y;
    pieces.push(piece);
  }

  function drawCuttingLine(nowMs) {
    if (!isDrawing || activePath.length < 2) return;

    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // Subtle preview of straight auto-close line back to start
    var first = activePath[0];
    var last = activePath[activePath.length - 1];
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(first.x, first.y);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.stroke();

    // Photoshop-style marching ants along the cursor path
    ctx.beginPath();
    for (var i = 0; i < activePath.length; i++) {
      if (i === 0) ctx.moveTo(activePath[i].x, activePath[i].y);
      else ctx.lineTo(activePath[i].x, activePath[i].y);
    }

    ctx.setLineDash([]);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.setLineDash([6, 4]);
    ctx.lineDashOffset = -(nowMs / 40);
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.restore();
  }

  function render(nowMs) {
    var dt = (nowMs - lastFrameTime) / 1000;
    lastFrameTime = nowMs;

    GravityPhysics.stepPieces(pieces, { width: viewWidth, height: viewHeight }, dt);

    // Solid black open canvas
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, viewWidth, viewHeight);

    // Draw base image (never stretched)
    if (sourceImage && imageRect) {
      ctx.drawImage(baseCanvas, imageRect.x, imageRect.y, imageRect.width, imageRect.height);
    }

    // Draw floating pieces
    for (var i = 0; i < pieces.length; i++) {
      var p = pieces[i];
      if (!p.canvas) continue;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.angle);
      ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
      ctx.shadowBlur = 12;
      ctx.drawImage(p.canvas, -p.offsetX, -p.offsetY, p.width, p.height);
      ctx.restore();
    }

    drawCuttingLine(nowMs);
    requestAnimationFrame(render);
  }

  // --- Event Listeners ---
  uploadBtn.addEventListener('click', function () {
    fileInput.click();
  });

  if (emptyUploadBtn) {
    emptyUploadBtn.addEventListener('click', function () {
      fileInput.click();
    });
  }

  fileInput.addEventListener('change', function (e) {
    if (e.target.files && e.target.files[0]) {
      loadImageFile(e.target.files[0]);
      fileInput.value = '';
    }
  });

  collageBtn.addEventListener('click', function () {
    collageMode = !collageMode;
    collageBtn.classList.toggle('active', collageMode);
    collageBtn.setAttribute('aria-pressed', collageMode ? 'true' : 'false');
    canvas.classList.toggle('collage-mode', collageMode);
    isDrawing = false;
    activePath = [];
    draggedPiece = null;
    activePointerId = null;
    canvas.classList.remove('collage-dragging');
  });

  saveImageBtn.addEventListener('click', function () {
    saveImage();
  });

  videoBtn.addEventListener('click', function () {
    if (isRecording) {
      stopVideo();
    } else {
      startVideo();
    }
  });

  resetBtn.addEventListener('click', function () {
    resetBaseImage();
  });

  modeToggle.addEventListener('click', function () {
    mode = mode === 'cut' ? 'duplicate' : 'cut';
    modeToggle.setAttribute('data-mode', mode);
    modeToggle.setAttribute('aria-checked', mode === 'duplicate' ? 'true' : 'false');
  });

  window.addEventListener('dragover', function (e) {
    e.preventDefault();
    stage.classList.add('drag-over');
  });

  window.addEventListener('dragleave', function (e) {
    if (e.clientX <= 0 || e.clientY <= 0 || e.clientX >= window.innerWidth || e.clientY >= window.innerHeight) {
      stage.classList.remove('drag-over');
    }
  });

  window.addEventListener('drop', function (e) {
    e.preventDefault();
    stage.classList.remove('drag-over');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
      loadImageFile(e.dataTransfer.files[0]);
    }
  });

  canvas.addEventListener('pointerdown', function (e) {
    if (!sourceImage || !imageRect) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    if (isDrawing || draggedPiece) return;
    var pt = getCanvasPoint(e.clientX, e.clientY);

    if (collageMode) {
      var hitIndex = findPieceAtPoint(pt);
      if (hitIndex === -1) return;
      var piece = pieces.splice(hitIndex, 1)[0];
      pieces.push(piece); // bring grabbed piece to front
      piece.state = 'frozen';
      piece.vx = 0;
      piece.vy = 0;
      piece.vAngle = 0;
      draggedPiece = piece;
      dragOffset = { x: pt.x - piece.x, y: pt.y - piece.y };
      activePointerId = e.pointerId;
      canvas.classList.add('collage-dragging');
      canvas.setPointerCapture(e.pointerId);
      return;
    }

    if (!isPointInRect(pt, imageRect)) return;

    isDrawing = true;
    activePointerId = e.pointerId;
    activePath = [pt];
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', function (e) {
    if (e.pointerId !== activePointerId) return;

    if (draggedPiece) {
      var dragPt = getCanvasPoint(e.clientX, e.clientY);
      draggedPiece.x = dragPt.x - dragOffset.x;
      draggedPiece.y = dragPt.y - dragOffset.y;
      return;
    }

    if (!isDrawing || !imageRect) return;
    var rawPt = getCanvasPoint(e.clientX, e.clientY);
    var pt = GravityGeometry.clampPointToRect(rawPt, imageRect);
    var prev = activePath[activePath.length - 1];
    var dx = pt.x - prev.x;
    var dy = pt.y - prev.y;
    if (dx * dx + dy * dy >= 9) {
      activePath.push(pt);
    }
  });

  function finishStroke(e) {
    if (e && e.pointerId !== activePointerId) return;

    if (draggedPiece) {
      draggedPiece.state = 'frozen';
      draggedPiece = null;
      activePointerId = null;
      canvas.classList.remove('collage-dragging');
      return;
    }

    if (!isDrawing) return;
    isDrawing = false;
    activePointerId = null;
    var poly = GravityGeometry.closeAndValidatePolygon(activePath, 3, 40);
    activePath = [];
    if (poly) {
      extractAndSpawnPiece(poly);
    }
  }

  function cancelStroke(e) {
    if (e && e.pointerId !== activePointerId) return;
    if (draggedPiece) {
      draggedPiece.state = 'frozen';
      draggedPiece = null;
      canvas.classList.remove('collage-dragging');
    }
    isDrawing = false;
    activePointerId = null;
    activePath = [];
  }

  canvas.addEventListener('pointerup', finishStroke);
  canvas.addEventListener('pointercancel', cancelStroke);

  window.addEventListener('resize', resizeCanvas);
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(resizeCanvas).observe(stage);
  }

  resizeCanvas();
  requestAnimationFrame(render);
})();
