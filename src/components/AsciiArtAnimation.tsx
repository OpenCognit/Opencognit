import { useEffect, useRef } from 'react';

export function AsciiArtAnimation() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Set canvas size
    const resizeCanvas = () => {
      canvas.width = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // ASCII characters for the animation
    const asciiChars = ' .:-=+*#%@';
    const particles: Array<{
      x: number;
      y: number;
      vx: number;
      vy: number;
      char: string;
      size: number;
      opacity: number;
    }> = [];

    // Create particles
    const particleCount = 80;
    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        char: asciiChars[Math.floor(Math.random() * asciiChars.length)],
        size: Math.random() * 14 + 10,
        opacity: Math.random() * 0.5 + 0.3,
      });
    }

    // OpenCognit logo pattern (simplified ASCII representation)
    const logoLines = [
      '  ██████╗ ███████╗███████╗████████╗   ████████╗ ██████╗  ██████╗ ██╗     ███████╗',
      '  ██╔══██╗██╔════╝██╔════╝╚══██╔══╝   ╚══██╔══╝██╔═══██╗██╔═══██╗██║     ██╔════╝',
      '  ██████╔╝█████╗  ███████╗   ██║         ██║   ██║   ██║██║   ██║██║     █████╗  ',
      '  ██╔══██╗██╔══╝  ╚════██║   ██║         ██║   ██║   ██║██║   ██║██║     ██╔══╝  ',
      '  ██║  ██║███████╗███████║   ██║         ██║   ╚██████╔╝╚██████╔╝███████╗███████╗',
      '  ╚═╝  ╚═╝╚══════╝╚══════╝   ╚═╝         ╚═╝    ╚═════╝  ╚═════╝ ╚══════╝╚══════╝',
    ];

    let frame = 0;
    let animationId: number;

    const animate = () => {
      ctx.fillStyle = '#09090b';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw gradient background
      const gradient = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
      gradient.addColorStop(0, 'rgba(37, 99, 235, 0.1)');
      gradient.addColorStop(0.5, 'rgba(147, 51, 234, 0.1)');
      gradient.addColorStop(1, 'rgba(79, 70, 229, 0.1)');
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Draw floating particles
      ctx.font = '12px monospace';
      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;

        // Bounce off walls
        if (p.x < 0 || p.x > canvas.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas.height) p.vy *= -1;

        // Draw particle
        ctx.fillStyle = `rgba(147, 197, 253, ${p.opacity})`;
        ctx.fillText(p.char, p.x, p.y);
      });

      // Draw OpenCognit text with wave effect
      ctx.font = 'bold 16px monospace';
      const centerY = canvas.height / 2;
      logoLines.forEach((line, index) => {
        const waveOffset = Math.sin(frame * 0.02 + index * 0.3) * 3;
        const x = (canvas.width - line.length * 8.4) / 2;
        const y = centerY + (index - logoLines.length / 2) * 18 + waveOffset;

        // Gradient color for text
        const textGradient = ctx.createLinearGradient(x, y, x + line.length * 8.4, y);
        textGradient.addColorStop(0, 'rgba(59, 130, 246, 0.8)');
        textGradient.addColorStop(0.5, 'rgba(167, 139, 250, 0.8)');
        textGradient.addColorStop(1, 'rgba(99, 102, 241, 0.8)');
        ctx.fillStyle = textGradient;
        ctx.fillText(line, x, y);
      });

      // Draw orbiting rings
      const time = frame * 0.01;
      for (let i = 0; i < 3; i++) {
        const radius = 150 + i * 40;
        const centerX = canvas.width / 2;
        const centerY = canvas.height / 2;

        ctx.beginPath();
        ctx.ellipse(
          centerX,
          centerY,
          radius,
          radius * 0.3,
          time + i * 0.5,
          0,
          Math.PI * 2
        );
        ctx.strokeStyle = `rgba(147, 197, 253, ${0.15 - i * 0.04})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }

      frame++;
      animationId = requestAnimationFrame(animate);
    };

    animate();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationId);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full"
      style={{ backgroundColor: '#09090b' }}
    />
  );
}
