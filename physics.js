(function (root) {
  'use strict';

  var BUOYANCY = -68; // gentle upward drift (px/s^2)
  var FALL_GRAVITY = 360; // real downward gravity for falling/piled objects
  var MAX_SPEED = 240;
  var DAMPING = 0.988;
  var FLOOR_FRICTION = 0.88;
  var PIECE_RESTITUTION = 0.45;
  var FALL_RESTITUTION = 0.22;
  var WALL_RESTITUTION = 0.4;

  /**
   * Creates a cutout piece.
   */
  function createPiece(opts) {
    var radius = Math.max(8, opts.radius || 20);
    return {
      id: opts.id,
      canvas: opts.canvas || null,
      x: opts.x,
      y: opts.y,
      vx: typeof opts.vx === 'number' ? opts.vx : (Math.random() - 0.5) * 18,
      vy: typeof opts.vy === 'number' ? opts.vy : -14 - Math.random() * 10,
      angle: opts.angle || 0,
      vAngle: typeof opts.vAngle === 'number' ? opts.vAngle : (Math.random() - 0.5) * 0.25,
      radius: radius,
      width: opts.width || radius * 2,
      height: opts.height || radius * 2,
      mass: Math.max(1, radius * radius),
      state: opts.state || 'floating', // 'floating' | 'falling' | 'frozen'
      collisions: 0
    };
  }

  /**
   * Marks half of the currently floating pieces to fall down into the bottom pile.
   */
  function triggerHalfDrop(pieces) {
    var floating = [];
    for (var i = 0; i < pieces.length; i++) {
      if (pieces[i].state === 'floating') {
        floating.push(pieces[i]);
      }
    }
    var toDrop = Math.ceil(floating.length / 2);
    for (var j = 0; j < toDrop; j++) {
      floating[j].state = 'falling';
      floating[j].vy = Math.max(floating[j].vy, 40);
    }
  }

  /**
   * Advances all pieces by dt seconds within bounds { width, height }.
   */
  function stepPieces(pieces, bounds, dt) {
    var stepDt = Math.min(Math.max(dt || 1 / 60, 0.001), 0.05);
    var dampingFactor = Math.pow(DAMPING, stepDt * 60);
    var floorFrictionFactor = Math.pow(FLOOR_FRICTION, stepDt * 60);
    var floatingCount = 0;
    var i, j;

    for (i = 0; i < pieces.length; i++) {
      if (pieces[i].state === 'floating') floatingCount++;
    }

    // 1. Integrate forces & motion
    for (i = 0; i < pieces.length; i++) {
      var p = pieces[i];
      if (p.state === 'frozen') {
        p.vx = 0;
        p.vy = 0;
        p.vAngle = 0;
        continue;
      }

      if (p.state === 'falling') {
        p.vy += FALL_GRAVITY * stepDt;
        p.vx *= dampingFactor;
        p.vAngle *= dampingFactor;
      } else {
        p.vy += BUOYANCY * stepDt;
        p.vx *= dampingFactor;
        p.vy *= dampingFactor;
        p.vAngle *= dampingFactor;
      }

      var speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      if (speed > MAX_SPEED) {
        var scale = MAX_SPEED / speed;
        p.vx *= scale;
        p.vy *= scale;
      }

      p.x += p.vx * stepDt;
      p.y += p.vy * stepDt;
      p.angle += p.vAngle * stepDt;
    }

    // 2. Pairwise collisions
    for (i = 0; i < pieces.length; i++) {
      for (j = i + 1; j < pieces.length; j++) {
        var a = pieces[i];
        var b = pieces[j];

        // Frozen pieces stay fixed in place and do not participate in collisions
        if (a.state === 'frozen' || b.state === 'frozen') {
          continue;
        }

        var dx = b.x - a.x;
        var dy = b.y - a.y;
        var minDist = a.radius + b.radius;
        var distSq = dx * dx + dy * dy;

        if (distSq < minDist * minDist) {
          var dist = Math.sqrt(distSq);
          var nx, ny;
          if (dist > 0.0001) {
            nx = dx / dist;
            ny = dy / dist;
          } else {
            nx = 1;
            ny = 0;
            dist = 0;
          }

          // Tipping instability if two falling objects stack almost dead-center
          if (a.state === 'falling' && b.state === 'falling' && Math.abs(nx) < 0.05) {
            nx = a.id % 2 === 0 ? -0.15 : 0.15;
            var normLen = Math.sqrt(nx * nx + ny * ny);
            nx /= normLen;
            ny /= normLen;
          }

          var overlap = minDist - dist;
          var totalMass = a.mass + b.mass;
          var ratioA = b.mass / totalMass;
          var ratioB = a.mass / totalMass;

          a.x -= nx * overlap * ratioA;
          a.y -= ny * overlap * ratioA;
          b.x += nx * overlap * ratioB;
          b.y += ny * overlap * ratioB;

          var rvx = b.vx - a.vx;
          var rvy = b.vy - a.vy;
          var velAlongNormal = rvx * nx + rvy * ny;

          if (velAlongNormal < 0) {
            var restitution = a.state === 'falling' && b.state === 'falling' ? FALL_RESTITUTION : PIECE_RESTITUTION;
            var impulse = -(1 + restitution) * velAlongNormal;
            impulse /= 1 / a.mass + 1 / b.mass;

            var ix = impulse * nx;
            var iy = impulse * ny;

            a.vx -= ix / a.mass;
            a.vy -= iy / a.mass;
            b.vx += ix / b.mass;
            b.vy += iy / b.mass;

            // Subtle roll/spin when objects slide off each other
            var tangent = rvx * -ny + rvy * nx;
            a.vAngle -= tangent * 0.0015;
            b.vAngle += tangent * 0.0015;

            // When crowded, some colliding floating pieces drop into the bottom pile
            if (floatingCount >= 5) {
              if (a.state === 'floating') a.collisions++;
              if (b.state === 'floating') b.collisions++;
              if (a.state === 'floating' && a.collisions >= 4 && a.id % 2 === 0) {
                a.state = 'falling';
              }
              if (b.state === 'floating' && b.collisions >= 4 && b.id % 2 === 1) {
                b.state = 'falling';
              }
            }
          }
        }
      }
    }

    // 3. Canvas bounds & real-object floor interaction
    for (i = 0; i < pieces.length; i++) {
      var piece = pieces[i];
      if (piece.state === 'frozen') continue;

      var r = piece.radius;
      var maxX = Math.max(r, bounds.width - r);
      var maxY = Math.max(r, bounds.height - r);

      if (piece.x < r) {
        piece.x = r;
        if (piece.vx < 0) piece.vx = -piece.vx * WALL_RESTITUTION;
      } else if (piece.x > maxX) {
        piece.x = maxX;
        if (piece.vx > 0) piece.vx = -piece.vx * WALL_RESTITUTION;
      }

      if (piece.y < r) {
        piece.y = r;
        if (piece.vy < 0) piece.vy = -piece.vy * WALL_RESTITUTION;
      } else if (piece.y >= maxY) {
        piece.y = maxY;
        if (piece.state === 'falling') {
          if (piece.vy > 28) {
            piece.vy = -piece.vy * FALL_RESTITUTION;
          } else {
            piece.vy = 0;
          }
          piece.vx *= floorFrictionFactor;
          piece.vAngle *= floorFrictionFactor;
          if (Math.abs(piece.vx) < 1) piece.vx = 0;
        } else if (piece.vy > 0) {
          piece.vy = -Math.max(20, piece.vy * WALL_RESTITUTION);
        }
      }
    }
  }

  root.GravityPhysics = {
    createPiece: createPiece,
    stepPieces: stepPieces,
    triggerHalfDrop: triggerHalfDrop
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
