(function (root) {
  'use strict';

  /**
   * Fits an image proportionally inside the canvas without stretching.
   * @param {number} imgWidth
   * @param {number} imgHeight
   * @param {number} canvasWidth
   * @param {number} canvasHeight
   * @param {number} padding
   * @returns {{ x: number, y: number, width: number, height: number }}
   */
  function fitImageRect(imgWidth, imgHeight, canvasWidth, canvasHeight, padding) {
    var pad = typeof padding === 'number' ? padding : 0;
    var availW = Math.max(1, canvasWidth - pad * 2);
    var availH = Math.max(1, canvasHeight - pad * 2);
    var scale = Math.min(availW / imgWidth, availH / imgHeight);
    var width = imgWidth * scale;
    var height = imgHeight * scale;
    var x = (canvasWidth - width) / 2;
    var y = (canvasHeight - height) / 2;
    return { x: x, y: y, width: width, height: height };
  }

  /**
   * Clamps a point to stay within a target rectangle.
   * @param {{ x: number, y: number }} point
   * @param {{ x: number, y: number, width: number, height: number }} rect
   * @returns {{ x: number, y: number }}
   */
  function clampPointToRect(point, rect) {
    var x = Math.max(rect.x, Math.min(rect.x + rect.width, point.x));
    var y = Math.max(rect.y, Math.min(rect.y + rect.height, point.y));
    return { x: x, y: y };
  }

  /**
   * Auto-closes a polygon with a straight line if needed, validates area/count,
   * and returns bounding box, centroid, collision radius, and area.
   * @param {Array<{ x: number, y: number }>} rawPoints
   * @param {number} minPoints
   * @param {number} minArea
   */
  function closeAndValidatePolygon(rawPoints, minPoints, minArea) {
    if (!rawPoints || rawPoints.length < (minPoints || 3)) {
      return null;
    }

    var points = rawPoints.map(function (p) {
      return { x: p.x, y: p.y };
    });

    var first = points[0];
    var last = points[points.length - 1];
    if (first.x !== last.x || first.y !== last.y) {
      points.push({ x: first.x, y: first.y });
    }

    var minX = Infinity;
    var minY = Infinity;
    var maxX = -Infinity;
    var maxY = -Infinity;
    var signedArea2 = 0;
    var cxSum = 0;
    var cySum = 0;

    for (var i = 0; i < points.length - 1; i++) {
      var p0 = points[i];
      var p1 = points[i + 1];
      if (p0.x < minX) minX = p0.x;
      if (p0.y < minY) minY = p0.y;
      if (p0.x > maxX) maxX = p0.x;
      if (p0.y > maxY) maxY = p0.y;

      var cross = p0.x * p1.y - p1.x * p0.y;
      signedArea2 += cross;
      cxSum += (p0.x + p1.x) * cross;
      cySum += (p0.y + p1.y) * cross;
    }

    var area = Math.abs(signedArea2) / 2;
    if (area < (minArea || 40)) {
      return null;
    }

    var bbox = {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY
    };

    var centroid;
    if (Math.abs(signedArea2) > 1e-6) {
      centroid = {
        x: cxSum / (3 * signedArea2),
        y: cySum / (3 * signedArea2)
      };
    } else {
      centroid = {
        x: minX + bbox.width / 2,
        y: minY + bbox.height / 2
      };
    }

    // Self-intersecting polygons can shoot the shoelace centroid outside the bbox
    if (
      centroid.x < minX ||
      centroid.x > maxX ||
      centroid.y < minY ||
      centroid.y > maxY
    ) {
      centroid = {
        x: minX + bbox.width / 2,
        y: minY + bbox.height / 2
      };
    }

    var maxDistSq = 0;
    for (var j = 0; j < points.length - 1; j++) {
      var dx = points[j].x - centroid.x;
      var dy = points[j].y - centroid.y;
      var dSq = dx * dx + dy * dy;
      if (dSq > maxDistSq) maxDistSq = dSq;
    }

    var radius = Math.max(8, Math.sqrt(maxDistSq) * 0.85);

    return {
      points: points,
      bbox: bbox,
      centroid: centroid,
      radius: radius,
      area: area
    };
  }

  root.GravityGeometry = {
    fitImageRect: fitImageRect,
    clampPointToRect: clampPointToRect,
    closeAndValidatePolygon: closeAndValidatePolygon
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
