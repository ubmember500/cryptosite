/**
 * Play a loud alert sound when an alert triggers
 * Uses Web Audio API for cross-browser compatibility
 */

let audioContext = null;

function initAudioContext() {
  if (typeof window === 'undefined') return null;
  if (audioContext) return audioContext;
  
  try {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    console.warn('Web Audio API not supported:', e);
    return null;
  }
  
  return audioContext;
}

async function resumeAudioContext() {
  const ctx = initAudioContext();
  if (!ctx) return false;
  
  if (ctx.state === 'suspended') {
    try {
      await ctx.resume();
    } catch (e) {
      console.warn('Failed to resume audio context:', e);
      return false;
    }
  }
  
  return true;
}

export async function playAlertSound() {
  const ctx = initAudioContext();
  if (!ctx) return;
  
  await resumeAudioContext();
  
  // Create three sequential beeps with increasing frequency for attention-grabbing sound
  const frequencies = [440, 554, 659]; // A4, C#5, E5 notes
  const duration = 0.15; // 150ms per beep
  const gap = 0.05; // 50ms gap between beeps
  
  frequencies.forEach((freq, index) => {
    setTimeout(() => {
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);
      
      oscillator.frequency.value = freq;
      oscillator.type = 'sine';
      
      // Envelope: quick attack, quick release
      const now = ctx.currentTime;
      gainNode.gain.setValueAtTime(0, now);
      gainNode.gain.linearRampToValueAtTime(0.5, now + 0.01); // Quick attack
      gainNode.gain.linearRampToValueAtTime(0.5, now + duration - 0.01);
      gainNode.gain.linearRampToValueAtTime(0, now + duration); // Quick release
      
      oscillator.start(now);
      oscillator.stop(now + duration);
    }, index * (duration + gap) * 1000);
  });
}

// Initialize audio context on first user interaction (required by browser autoplay policies)
if (typeof window !== 'undefined') {
  const initOnInteraction = () => {
    initAudioContext();
    window.removeEventListener('click', initOnInteraction);
    window.removeEventListener('keydown', initOnInteraction);
    window.removeEventListener('touchstart', initOnInteraction);
  };
  
  window.addEventListener('click', initOnInteraction, { once: true });
  window.addEventListener('keydown', initOnInteraction, { once: true });
  window.addEventListener('touchstart', initOnInteraction, { once: true });
}
