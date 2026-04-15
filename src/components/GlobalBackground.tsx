"use client";

import React, { useEffect, useRef } from "react";

const colors = {
  300: "#23CDCB",
  500: "#089191",
};

export function GlobalBackground() {
  const gradientRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Mouse gradient
    const gradient = gradientRef.current;
    function onMouseMove(e: MouseEvent) {
      if (gradient) {
        gradient.style.left = e.clientX - 192 + "px";
        gradient.style.top = e.clientY - 192 + "px";
        gradient.style.opacity = "1";
      }
    }
    function onMouseLeave() {
      if (gradient) gradient.style.opacity = "0";
    }
    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseleave", onMouseLeave);

    // Click ripple effect
    function onClick(e: MouseEvent) {
      const ripple = document.createElement("div");
      ripple.style.position = "fixed";
      ripple.style.left = e.clientX + "px";
      ripple.style.top = e.clientY + "px";
      ripple.style.width = "4px";
      ripple.style.height = "4px";
      ripple.style.background = "rgba(35, 205, 202, 0.6)";
      ripple.style.borderRadius = "50%";
      ripple.style.transform = "translate(-50%, -50%)";
      ripple.style.pointerEvents = "none";
      ripple.style.animation = "pulse-glow 1s ease-out forwards";
      ripple.style.zIndex = "9999";
      document.body.appendChild(ripple);
      setTimeout(() => ripple.remove(), 1000);
    }
    document.addEventListener("click", onClick);

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseleave", onMouseLeave);
      document.removeEventListener("click", onClick);
    };
  }, []);

  return (
    <div className="fixed inset-0 z-0 pointer-events-none">
      {/* Background gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#0a0a0f] via-black to-[#0c1525]" />

      {/* Grid Pattern */}
      <svg className="absolute inset-0 w-full h-full" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path
              d="M 60 0 L 0 0 0 60"
              fill="none"
              stroke="rgba(56, 189, 248, 0.12)"
              strokeWidth="0.5"
            />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        <line x1="0" y1="20%" x2="100%" y2="20%" className="grid-line" style={{ animationDelay: "0.2s" }} />
        <line x1="0" y1="80%" x2="100%" y2="80%" className="grid-line" style={{ animationDelay: "0.5s" }} />
        <line x1="20%" y1="0" x2="20%" y2="100%" className="grid-line" style={{ animationDelay: "0.8s" }} />
        <line x1="80%" y1="0" x2="80%" y2="100%" className="grid-line" style={{ animationDelay: "1.1s" }} />
        <line x1="50%" y1="0" x2="50%" y2="100%" className="grid-line" style={{ animationDelay: "1.4s", opacity: 0.1 }} />
        <line x1="0" y1="50%" x2="100%" y2="50%" className="grid-line" style={{ animationDelay: "1.7s", opacity: 0.1 }} />
        <circle cx="20%" cy="20%" r="2" className="detail-dot" style={{ animationDelay: "2s" }} />
        <circle cx="80%" cy="20%" r="2" className="detail-dot" style={{ animationDelay: "2.2s" }} />
        <circle cx="20%" cy="80%" r="2" className="detail-dot" style={{ animationDelay: "2.4s" }} />
        <circle cx="80%" cy="80%" r="2" className="detail-dot" style={{ animationDelay: "2.6s" }} />
        <circle cx="50%" cy="50%" r="1.5" className="detail-dot" style={{ animationDelay: "3s" }} />
        <circle cx="35%" cy="40%" r="1" className="detail-dot" style={{ animationDelay: "3.2s" }} />
        <circle cx="65%" cy="60%" r="1" className="detail-dot" style={{ animationDelay: "3.4s" }} />
        <circle cx="10%" cy="45%" r="1" className="detail-dot" style={{ animationDelay: "3.6s" }} />
        <circle cx="90%" cy="55%" r="1" className="detail-dot" style={{ animationDelay: "3.8s" }} />
      </svg>

      {/* Corner elements */}
      <div className="corner-element top-8 left-8" style={{ animationDelay: "3.5s" }}>
        <div className="absolute top-0 left-0 w-2 h-2 opacity-30" style={{ background: colors[300] }} />
      </div>
      <div className="corner-element top-8 right-8" style={{ animationDelay: "3.7s" }}>
        <div className="absolute top-0 right-0 w-2 h-2 opacity-30" style={{ background: colors[300] }} />
      </div>
      <div className="corner-element bottom-8 left-8" style={{ animationDelay: "3.9s" }}>
        <div className="absolute bottom-0 left-0 w-2 h-2 opacity-30" style={{ background: colors[300] }} />
      </div>
      <div className="corner-element bottom-8 right-8" style={{ animationDelay: "4.1s" }}>
        <div className="absolute bottom-0 right-0 w-2 h-2 opacity-30" style={{ background: colors[300] }} />
      </div>

      {/* Floating elements - staggered across the screen */}
      <div className="floating-element" style={{ top: "25%", left: "15%", animationDelay: "2s", animationPlayState: "running" }} />
      <div className="floating-element" style={{ top: "60%", left: "85%", animationDelay: "2.5s", animationPlayState: "running" }} />
      <div className="floating-element" style={{ top: "40%", left: "10%", animationDelay: "3s", animationPlayState: "running" }} />
      <div className="floating-element" style={{ top: "75%", left: "90%", animationDelay: "3.5s", animationPlayState: "running" }} />
      <div className="floating-element" style={{ top: "15%", left: "45%", animationDelay: "4s", animationPlayState: "running" }} />
      <div className="floating-element" style={{ top: "85%", left: "30%", animationDelay: "4.5s", animationPlayState: "running" }} />
      <div className="floating-element" style={{ top: "30%", left: "70%", animationDelay: "5s", animationPlayState: "running" }} />
      <div className="floating-element" style={{ top: "50%", left: "40%", animationDelay: "5.5s", animationPlayState: "running" }} />
      <div className="floating-element" style={{ top: "10%", left: "80%", animationDelay: "6s", animationPlayState: "running" }} />
      <div className="floating-element" style={{ top: "90%", left: "60%", animationDelay: "6.5s", animationPlayState: "running" }} />
      <div className="floating-element" style={{ top: "45%", left: "25%", animationDelay: "7s", animationPlayState: "running" }} />
      <div className="floating-element" style={{ top: "70%", left: "15%", animationDelay: "7.5s", animationPlayState: "running" }} />
      <div className="floating-element" style={{ top: "20%", left: "95%", animationDelay: "8s", animationPlayState: "running" }} />
      <div className="floating-element" style={{ top: "55%", left: "35%", animationDelay: "8.5s", animationPlayState: "running" }} />
      <div className="floating-element" style={{ top: "80%", left: "50%", animationDelay: "9s", animationPlayState: "running" }} />

      {/* Mouse gradient */}
      <div
        ref={gradientRef}
        className="fixed pointer-events-none w-96 h-96 rounded-full blur-3xl transition-all duration-500 ease-out opacity-0 z-0"
        style={{ background: `radial-gradient(circle, ${colors[500]}1A 0%, transparent 100%)` }}
      />
    </div>
  );
}
