'use client';

import { useEffect, useRef } from 'react';

// За прямим запитом користувача — "добавить на экране отображения камеры мини-карту на 33%
// экрана с отображением азимута и сектора обзора этой камеры" (locked-екран, apps/btw/app/
// page.tsx). Той самий підхід/патерн, що вже BtwRadar.tsx (статичний Canvas 2D, перемальовка
// лише коли міняються пропси, без requestAnimationFrame-циклу — не садить батарею дарма).
//
// NORTH-UP (а не heading-up, як основний радар вище): тут показується ВЛАСНА орієнтація
// камери у просторі (звідки вона фізично дивиться) — це не змінюється разом із тим, куди
// зараз повернутий телефон користувача, тож north-up (компас, "N" завжди вгорі) природніший
// для читання "куди дивиться камера", ніж прив'язка до поточного heading.

interface BtwCameraMiniMapProps {
  cameraAzimuth: number;
  // Опційне — § детальний коментар біля Candidate.fovAngle у page.tsx (старий закешований
  // тайл/сервер міг не віддати це поле). 90° — нейтральний дефолт (типовий widescreen FOV),
  // краще показати ПРИБЛИЗНИЙ сектор, ніж узагалі нічого не намалювати.
  fovAngle?: number;
}

const SIZE = 260; // логічна (CSS) роздільна здатність канваса — сам канвас відображається responsively (§ обгортка в page.tsx, height:33vh + aspect-square), CSS width/height:100% розтягує/стискає цей растр
const DEFAULT_FOV_DEG = 90;

export default function BtwCameraMiniMap({ cameraAzimuth, fovAngle }: BtwCameraMiniMapProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const effectiveFov = fovAngle ?? DEFAULT_FOV_DEG;

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
    const maxR = SIZE / 2 - 45; // запас під підписи сторін світу й азимут/FOV-текст знизу

    // Зовнішнє коло + сторони світу — north-up, "N" завжди вгорі (§ коментар вище).
    ctx.strokeStyle = 'rgba(255,255,255,0.2)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, maxR, 0, Math.PI * 2);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('N', cx, cy - maxR - 8);
    ctx.fillText('S', cx, cy + maxR + 16);
    ctx.fillText('W', cx - maxR - 12, cy + 4);
    ctx.fillText('E', cx + maxR + 12, cy + 4);

    // Азимут (0°=північ, за годинниковою стрілкою) -> кут канваса (0 рад = вправо, за
    // годинниковою) — той самий зсув на -90°, що вже worldBearingToCanvasAngle() в
    // BtwRadar.tsx застосовує для heading-up, тут без компенсації heading (north-up).
    const azimuthToCanvasAngle = (deg: number) => ((deg - 90) * Math.PI) / 180;

    // Сектор огляду камери — заливка від центру до самого краю кола (тут це ЄДИНИЙ об'єкт на
    // міні-карті, на відміну від маленьких "прапорців" біля точок кандидатів на основному
    // радарі, § BtwRadar.tsx).
    const halfFovRad = (effectiveFov / 2) * (Math.PI / 180);
    const centerRad = azimuthToCanvasAngle(cameraAzimuth);
    ctx.fillStyle = 'rgba(74,222,128,0.35)';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, maxR, centerRad - halfFovRad, centerRad + halfFovRad);
    ctx.closePath();
    ctx.fill();

    // Лінія точно по центру сектора (сам азимут) — для точності поверх заливки.
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + maxR * Math.cos(centerRad), cy + maxR * Math.sin(centerRad));
    ctx.stroke();

    // Камера — точка по центру.
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(cx, cy, 5, 0, Math.PI * 2);
    ctx.fill();

    // Підпис азимута/FOV знизу.
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    ctx.font = '11px sans-serif';
    ctx.fillText(`${Math.round(cameraAzimuth)}° · обзор ${Math.round(effectiveFov)}°`, cx, cy + maxR + 34);
  }, [cameraAzimuth, effectiveFov]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '100%' }}
      className="block"
      aria-label={`Направление и сектор обзора камеры: азимут ${Math.round(cameraAzimuth)}°, угол обзора ${Math.round(effectiveFov)}°`}
    />
  );
}
