'use client';

import React, { useEffect, useRef } from 'react';

// Beyond the Wall (BTW) — кільце-радар на Canvas, §3.1.2 ТЗ (doc/BTW-tz.md).
//
// За прямим запитом користувача ("реализуй радар из ТЗ с секторами и отметками") — але в
// СВІДОМО зменшеному обсязі, який сам користувач і визначив: СТАТИЧНИЙ Canvas 2D (без
// requestAnimationFrame-циклу — не грати батарею дарма під час активного GPS+компас
// сканування, перемальовується лише коли міняються heading/candidates), БЕЗ Web Worker і
// БЕЗ PMTiles/офлайн-геометрії (це лишається задокументованим у doc/AUDIT-btw.md як окремий
// майбутній обсяг), і БЕЗ окремого ендпоінту — поверх тих самих полів, що вже приходять у
// відповіді /btw/scan (bearingToTarget, distanceM, orientationFit).
//
// ⚠️ ОНОВЛЕНО: спершу секторів тут узагалі не було реальних (cam.azimuth не передавався
// клієнту) — нижче саме тому й описано, чому це довелось змінити.
//
// ВИПРАВЛЕНО (реальний баг, знайдений користувачем на скріні — locked-view показував "~84°"
// поруч із міткою "почти совпадает", хоча ALIGNED вимагає delta≤45°): "сектор" тут раніше був
// СТИЛІЗОВАНИМ наближенням з orientationFit, бо cam.azimuth не передавався клієнту. Сервер
// тепер віддає справжній cameraAzimuth (btw.service.ts, той самий, що вже й
// classifyOrientationFit() використовує) — сектор тепер малюється з РЕАЛЬНОГО азимута камери,
// не з категорії.

export interface BtwRadarCandidate {
  cameraId: string;
  distanceM: number;
  bearingToTarget: number;
  coverage: number;
  orientationFit: 'ALIGNED' | 'SIDE' | 'OPPOSING';
  cameraAzimuth: number;
  isFallback: boolean;
}

interface BtwRadarProps {
  heading: number | null;
  candidates: BtwRadarCandidate[];
  onSelect: (cameraId: string) => void;
}

const SIZE = 200; // CSS-пікселі, квадратний канвас
// За прямим запитом користувача ("reusing data already in scanDebug/candidates") — не нове
// мережеве поле, а той самий ліміт, що вже задає сервер (MAX_DISTANCE_M у
// btw-geometry.util.ts::computeTargetZone) — кандидати далі просто притискаються до краю
// кільця, не губляться і не тягнуть за собою окремий розрахунок масштабу.
const MAX_RANGE_M = 400;

export default function BtwRadar({ heading, candidates, onSelect }: BtwRadarProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hitAreasRef = useRef<{ cameraId: string; x: number; y: number; r: number }[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);

    const cx = SIZE / 2;
    const cy = SIZE / 2;
    const maxR = SIZE / 2 - 16; // запас під підписи кілець дистанції

    // Кільця дистанції — статичні (без обертання разом із компасом, heading-up-режим — "вперед"
    // завжди вгорі канваса, той самий принцип, що вже в компас-стрічці нижче).
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.fillStyle = 'rgba(255,255,255,0.4)';
    ctx.font = '9px sans-serif';
    ctx.lineWidth = 1;
    [1 / 3, 2 / 3, 1].forEach((frac) => {
      ctx.beginPath();
      ctx.arc(cx, cy, maxR * frac, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillText(`${Math.round(MAX_RANGE_M * frac)}м`, cx + 3, cy - maxR * frac + 9);
    });

    // Осі north/south/east/west відносно поточного напрямку погляду.
    ctx.beginPath();
    ctx.moveTo(cx, cy - maxR);
    ctx.lineTo(cx, cy + maxR);
    ctx.moveTo(cx - maxR, cy);
    ctx.lineTo(cx + maxR, cy);
    ctx.stroke();

    // "Ви" — трикутник по центру, завжди дивиться вгору (heading-up).
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(cx, cy - 7);
    ctx.lineTo(cx - 5, cy + 5);
    ctx.lineTo(cx + 5, cy + 5);
    ctx.closePath();
    ctx.fill();

    const hitAreas: { cameraId: string; x: number; y: number; r: number }[] = [];

    if (heading != null) {
      const headingDeg = heading; // локальна звужена константа — heading: number|null, а
      // замикання нижче фіксується один раз тут, TS звужує тип лише в цьому блоці.

      // Переводить світовий азимут (0..360°, північ=0) у кут канваса в heading-up режимі —
      // той самий розрахунок, що вже використовує компас-стрічка нижче (rel = bearing - heading),
      // винесений сюди один раз, бо тепер застосовується і до позиції точки (bearingToTarget), і
      // окремо до напрямку сектора (cameraAzimuth).
      const worldBearingToCanvasAngle = (worldBearingDeg: number) => {
        const rel = ((worldBearingDeg - headingDeg + 540) % 360) - 180;
        return ((rel - 90) * Math.PI) / 180; // 0° (попереду) -> вгору канвасу
      };

      for (const c of candidates) {
        const angleRad = worldBearingToCanvasAngle(c.bearingToTarget);
        const clampedDist = Math.min(c.distanceM, MAX_RANGE_M);
        const r = (clampedDist / MAX_RANGE_M) * maxR;
        const x = cx + r * Math.cos(angleRad);
        const y = cy + r * Math.sin(angleRad);

        // Напрямок сектора — справжній азимут камери, переведений у ту саму систему координат.
        const wedgeCenterRad = worldBearingToCanvasAngle(c.cameraAzimuth);

        const wedgeHalf = (28 * Math.PI) / 180;
        const wedgeLen = 13;
        ctx.fillStyle =
          c.orientationFit === 'ALIGNED' ? 'rgba(74,222,128,0.28)' : c.orientationFit === 'OPPOSING' ? 'rgba(248,113,113,0.28)' : 'rgba(251,191,36,0.28)';
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.arc(x, y, wedgeLen, wedgeCenterRad - wedgeHalf, wedgeCenterRad + wedgeHalf);
        ctx.closePath();
        ctx.fill();

        // Fallback-кандидати (SIDE/OPPOSING, розкриті вручну) — тьмяніша точка, щоб не
        // плутати з прямим (ALIGNED) ракурсом, той самий принцип кольору, що вже в списку
        // кандидатів нижче.
        ctx.fillStyle = c.isFallback ? '#f59e0b' : '#4ade80';
        ctx.beginPath();
        ctx.arc(x, y, 4, 0, Math.PI * 2);
        ctx.fill();

        hitAreas.push({ cameraId: c.cameraId, x, y, r: 12 }); // тап-радіус трохи більший за саму точку
      }
    }

    hitAreasRef.current = hitAreas;
  }, [heading, candidates]);

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    let closest: { cameraId: string; d: number } | null = null;
    for (const h of hitAreasRef.current) {
      const d = Math.hypot(h.x - x, h.y - y);
      if (d <= h.r && (closest == null || d < closest.d)) closest = { cameraId: h.cameraId, d };
    }
    if (closest) onSelect(closest.cameraId);
  }

  return (
    <canvas
      ref={canvasRef}
      style={{ width: SIZE, height: SIZE }}
      onClick={handleClick}
      className="mx-auto block touch-manipulation"
      aria-label="Радар — камеры поблизости, зелёный = прямой ракурс, жёлтый = резервный"
    />
  );
}
