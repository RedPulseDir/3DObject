/**
 * CAMERA MODULE
 * Управление камерой устройства
 */

const Camera = (() => {
  let stream = null;
  let videoEl = null;
  let isReady = false;
  let constraints = {
    video: {
      facingMode: { ideal: 'environment' },
      width: { ideal: 1920, min: 640 },
      height: { ideal: 1080, min: 480 },
      frameRate: { ideal: 30 }
    },
    audio: false
  };

  /**
   * Запросить доступ к камере
   */
  async function init(videoElement) {
    videoEl = videoElement;
    
    try {
      // Пробуем заднюю камеру
      stream = await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err) {
      console.warn('Задняя камера недоступна, пробуем любую:', err);
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false
        });
      } catch (err2) {
        throw new Error('Камера недоступна: ' + err2.message);
      }
    }

    videoEl.srcObject = stream;
    
    return new Promise((resolve, reject) => {
      videoEl.onloadedmetadata = () => {
        videoEl.play().then(() => {
          isReady = true;
          console.log(`Камера: ${videoEl.videoWidth}x${videoEl.videoHeight}`);
          resolve({
            width: videoEl.videoWidth,
            height: videoEl.videoHeight
          });
        }).catch(reject);
      };
      videoEl.onerror = reject;
    });
  }

  /**
   * Захватить кадр с видео в canvas
   */
  function captureFrame(canvas) {
    if (!isReady || !videoEl) return null;
    
    const ctx = canvas.getContext('2d');
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    ctx.drawImage(videoEl, 0, 0);
    
    return canvas.toDataURL('image/jpeg', 0.85);
  }

  /**
   * Захватить кадр как ImageData для обработки
   */
  function captureFrameData(tempCanvas) {
    if (!isReady || !videoEl) return null;
    
    const canvas = tempCanvas || document.createElement('canvas');
    canvas.width = videoEl.videoWidth;
    canvas.height = videoEl.videoHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(videoEl, 0, 0);
    
    return {
      imageData: ctx.getImageData(0, 0, canvas.width, canvas.height),
      canvas,
      ctx,
      width: canvas.width,
      height: canvas.height
    };
  }

  /**
   * Остановить камеру
   */
  function stop() {
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
      isReady = false;
    }
    if (videoEl) {
      videoEl.srcObject = null;
    }
  }

  /**
   * Переключить камеру (перед/зад)
   */
  async function switchCamera() {
    const currentFacing = constraints.video.facingMode?.ideal;
    constraints.video.facingMode = {
      ideal: currentFacing === 'environment' ? 'user' : 'environment'
    };
    stop();
    return init(videoEl);
  }

  /**
   * Получить текущий трек камеры
   */
  function getTrack() {
    return stream?.getVideoTracks()[0] || null;
  }

  /**
   * Включить/выключить фонарик
   */
  async function toggleTorch(enable) {
    const track = getTrack();
    if (!track) return;
    
    try {
      await track.applyConstraints({ advanced: [{ torch: enable }] });
    } catch (e) {
      console.warn('Фонарик недоступен:', e);
    }
  }

  return { init, captureFrame, captureFrameData, stop, switchCamera, toggleTorch, get isReady() { return isReady; } };
})();
