"use client";
import React, { useState, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useAuth } from "@/hooks/useAuth";
import { ApiError } from "@/api/client";
import { Sparkles, Cpu, Shield, Zap } from "lucide-react";
import { useI18n } from "@/i18n";

export function LoginPage({ erstesKonto = false }: { erstesKonto?: boolean }) {
  const { anmelden, registrieren } = useAuth();
  const { t, language, setLanguage } = useI18n();
  const [modus, setModus] = useState<"anmelden" | "registrieren">(erstesKonto ? "registrieren" : "anmelden");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [passwort, setPasswort] = useState("");
  const [fehler, setFehler] = useState("");
  const [laden, setLaden] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const isGerman = language === 'de';

  const particles = useMemo(() =>
    [...Array(35)].map((_, i) => ({
      id: i,
      size: 2 + Math.random() * 4,
      opacity: 0.2 + Math.random() * 0.5,
      top: Math.random() * 100,
      left: Math.random() * 100,
      glow: 4 + Math.random() * 8,
      duration: 6 + Math.random() * 8,
      delay: Math.random() * 5,
    }))
  , []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFehler("");
    setLaden(true);
    try {
      if (modus === "anmelden") {
        await anmelden(email, passwort);
      } else {
        await registrieren(name, email, passwort);
      }
      window.location.href = "/";
    } catch (err) {
      if (err instanceof ApiError) setFehler(err.message);
      else setFehler(t.login.error);
    } finally {
      setLaden(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "0.8rem 1rem 0.8rem 2.75rem",
    backgroundColor: "rgba(255, 255, 255, 0.03)",
    border: "1px solid rgba(255, 255, 255, 0.08)",
    borderRadius: 0,
    color: "#ffffff",
    fontSize: "0.9rem",
    outline: "none",
    transition: "all 0.2s ease",
    boxSizing: "border-box" as const,
  };

  const Icon = ({ d }: { d: string }) => (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ width: 18, height: 18 }}>
      <path d={d} />
    </svg>
  );

  const features = isGerman
    ? [
        { icon: Cpu, label: "Autonome Agenten", desc: "KI-Teams die selbständig arbeiten" },
        { icon: Zap, label: "Echtzeit-Steuerung", desc: "Live-Einblick in jeden Prozess" },
        { icon: Shield, label: "Atomare Budgets", desc: "Cent-genaue Kostenkontrolle" },
      ]
    : [
        { icon: Cpu, label: "Autonomous Agents", desc: "AI teams that work independently" },
        { icon: Zap, label: "Real-time Control", desc: "Live insight into every process" },
        { icon: Shield, label: "Atomic Budgets", desc: "Cent-accurate cost control" },
      ];

  return (
    <div style={{
      display: "flex", alignItems: "center", justifyContent: "center",
      minHeight: "100vh", position: "relative",
      background: "#000000",
      overflow: "hidden",
    }}>
      {/* Cyan Particles on Black */}
      <div style={{ position: "absolute", inset: 0, zIndex: 0, pointerEvents: "none", overflow: "hidden" }}>
        {particles.map((p) => (
          <div key={p.id} style={{
            position: "absolute",
            width: p.size, height: p.size,
            background: `rgba(197, 160, 89, ${p.opacity})`,
            borderRadius: "50%",
            top: `${p.top}%`,
            left: `${p.left}%`,
            boxShadow: `0 0 ${p.glow}px rgba(197, 160, 89, ${p.opacity * 0.6})`,
            animation: `float ${p.duration}s ease-in-out infinite`,
            animationDelay: `${p.delay}s`,
          }} />
        ))}
      </div>

      {/* Sprach-Toggle */}
      <button
        onClick={() => setLanguage(language === 'de' ? 'en' : 'de')}
        style={{
          position: "fixed", top: "1.5rem", right: "1.5rem", zIndex: 100,
          padding: "0.4rem 0.85rem", borderRadius: 0,
          background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
          color: "#71717a", cursor: "pointer", fontSize: "0.8125rem", fontWeight: 600,
          display: "flex", alignItems: "center", gap: "0.375rem", transition: "all 0.2s",
          backdropFilter: "blur(10px)",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "rgba(197,160,89,0.4)"; e.currentTarget.style.color = "#c5a059"; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.08)"; e.currentTarget.style.color = "#71717a"; }}
      >
        {language === 'de' ? '🇺🇸 EN' : '🇩🇪 DE'}
      </button>

      {/* Main Content */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: "easeOut" }}
        style={{
          position: "relative", zIndex: 10,
          display: "flex", flexDirection: "column", alignItems: "center",
          gap: "2.5rem", padding: "2rem", maxWidth: "440px", width: "100%",
        }}
      >
        {/* Logo + Title */}
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "0.5rem" }}>
          <img
            src="/opencognit.svg"
            alt="OpenCognit"
            style={{
              width: "140px", height: "140px", objectFit: "contain",
              filter: "drop-shadow(0 0 30px rgba(197,160,89,0.25))",
            }}
          />
          <h1 style={{
            fontSize: "1.75rem", fontWeight: 700, letterSpacing: "-0.02em",
            background: "linear-gradient(135deg, #ffffff 0%, #c5a059 100%)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
            margin: "0.25rem 0 0",
          }}>
            OpenCognit
          </h1>
          <p style={{
            fontSize: "0.8125rem", color: "#52525b", margin: 0, textAlign: "center",
          }}>
            {t.login.description}
          </p>
        </div>

        {/* Card */}
        <div style={{
          width: "100%", padding: "2rem",
          background: "rgba(255,255,255,0.02)",
          backdropFilter: "blur(24px)",
          borderRadius: 0,
          border: "1px solid rgba(255,255,255,0.06)",
          boxShadow: "0 20px 50px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)",
        }}>
          {/* Auth Tabs */}
          <div style={{
            display: "flex",
            background: "rgba(255,255,255,0.03)",
            padding: "3px", borderRadius: 0,
            marginBottom: "1.75rem",
            border: "1px solid rgba(255,255,255,0.04)",
          }}>
            {(["anmelden", "registrieren"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                data-testid={tab === "anmelden" ? "tab-signin" : "tab-signup"}
                onClick={() => { setModus(tab); setFehler(""); setName(""); }}
                style={{
                  position: "relative", flex: 1,
                  padding: "0.65rem 1rem",
                  fontSize: "0.8125rem", fontWeight: 600,
                  color: modus === tab ? "#ffffff" : "#52525b",
                  background: "transparent", border: "none",
                  cursor: "pointer", transition: "color 0.2s", zIndex: 1,
                }}
              >
                {modus === tab && (
                  <motion.div
                    layoutId="auth-tab"
                    style={{
                      position: "absolute", inset: 0,
                      background: "rgba(197,160,89,0.12)",
                      border: "1px solid rgba(197,160,89,0.2)",
                      borderRadius: 0, zIndex: -1,
                    }}
                    transition={{ type: "spring", bounce: 0.15, duration: 0.5 }}
                  />
                )}
                {tab === "anmelden" ? t.login.signIn : t.login.signUp}
              </button>
            ))}
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>

            {/* Error */}
            {fehler && (
              <div style={{
                display: "flex", alignItems: "center", gap: "0.5rem",
                padding: "0.75rem 1rem", borderRadius: 0,
                background: "rgba(239,68,68,0.08)", border: "1px solid rgba(239,68,68,0.15)",
              }}>
                <div style={{
                  width: 6, height: 6, borderRadius: "50%", background: "#ef4444", flexShrink: 0,
                  boxShadow: "0 0 8px rgba(239,68,68,0.5)",
                }} />
                <p style={{ fontSize: "0.8125rem", color: "#fca5a5", margin: 0 }}>{fehler}</p>
              </div>
            )}

            {/* Name */}
            {modus === "registrieren" && (
              <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
                <label style={{ fontSize: "0.75rem", fontWeight: 500, color: "#a1a1aa", letterSpacing: "0.02em" }}>{t.login.name}</label>
                <div style={{ position: "relative" }}>
                  <div style={{ position: "absolute", left: "0.85rem", top: "50%", transform: "translateY(-50%)", color: "#3f3f46", pointerEvents: "none" }}>
                    <Icon d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z" />
                  </div>
                  <input type="text" data-testid="register-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={t.login.namePlaceholder} required style={inputStyle}
                    onFocus={(e) => { e.target.style.borderColor = "rgba(197,160,89,0.5)"; e.target.style.boxShadow = "0 0 0 3px rgba(197,160,89,0.08)"; }}
                    onBlur={(e) => { e.target.style.borderColor = "rgba(255,255,255,0.08)"; e.target.style.boxShadow = "none"; }}
                  />
                </div>
              </div>
            )}

            {/* Email */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              <label style={{ fontSize: "0.75rem", fontWeight: 500, color: "#a1a1aa", letterSpacing: "0.02em" }}>{t.login.email}</label>
              <div style={{ position: "relative" }}>
                <div style={{ position: "absolute", left: "0.85rem", top: "50%", transform: "translateY(-50%)", color: "#3f3f46", pointerEvents: "none" }}>
                  <Icon d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2zM22 6l-10 7L2 6" />
                </div>
                <input type="email" data-testid="login-email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={t.login.emailPlaceholder} required style={inputStyle}
                  onFocus={(e) => { e.target.style.borderColor = "rgba(197,160,89,0.5)"; e.target.style.boxShadow = "0 0 0 3px rgba(197,160,89,0.08)"; }}
                  onBlur={(e) => { e.target.style.borderColor = "rgba(255,255,255,0.08)"; e.target.style.boxShadow = "none"; }}
                />
              </div>
            </div>

            {/* Password */}
            <div style={{ display: "flex", flexDirection: "column", gap: "0.4rem" }}>
              <label style={{ fontSize: "0.75rem", fontWeight: 500, color: "#a1a1aa", letterSpacing: "0.02em" }}>{t.login.password}</label>
              <div style={{ position: "relative" }}>
                <div style={{ position: "absolute", left: "0.85rem", top: "50%", transform: "translateY(-50%)", color: "#3f3f46", pointerEvents: "none" }}>
                  <Icon d="M19 11H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7a2 2 0 0 0-2-2zM7 11V7a5 5 0 0 1 10 0v4" />
                </div>
                <input
                  type={showPassword ? "text" : "password"} data-testid="login-password" value={passwort}
                  onChange={(e) => setPasswort(e.target.value)}
                  placeholder={modus === "anmelden" ? t.login.passwordPlaceholder : t.login.passwordMinLength}
                  required style={inputStyle}
                  onFocus={(e) => { e.target.style.borderColor = "rgba(197,160,89,0.5)"; e.target.style.boxShadow = "0 0 0 3px rgba(197,160,89,0.08)"; }}
                  onBlur={(e) => { e.target.style.borderColor = "rgba(255,255,255,0.08)"; e.target.style.boxShadow = "none"; }}
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} style={{
                  position: "absolute", right: "0.85rem", top: "50%", transform: "translateY(-50%)",
                  background: "none", border: "none", cursor: "pointer", padding: "0.25rem",
                  color: "#3f3f46", transition: "color 0.2s",
                }}
                  onMouseEnter={(e) => e.currentTarget.style.color = "#a1a1aa"}
                  onMouseLeave={(e) => e.currentTarget.style.color = "#3f3f46"}
                >
                  {showPassword ? (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 18, height: 18 }}>
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" style={{ width: 18, height: 18 }}>
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button type="submit" data-testid="login-submit" disabled={laden} style={{
              marginTop: "0.5rem", width: "100%", padding: "0.85rem",
              background: laden ? "rgba(197,160,89,0.3)" : "linear-gradient(135deg, #c5a059 0%, #c5a059 100%)",
              color: "#fff", fontWeight: 700, fontSize: "0.9rem",
              borderRadius: 0, border: "none",
              cursor: laden ? "not-allowed" : "pointer",
              transition: "all 0.25s ease",
              boxShadow: laden ? "none" : "0 4px 20px rgba(197,160,89,0.3)",
              letterSpacing: "0.01em",
            }}
              onMouseEnter={(e) => { if (!laden) { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 30px rgba(197,160,89,0.4)"; } }}
              onMouseLeave={(e) => { e.currentTarget.style.transform = "translateY(0)"; e.currentTarget.style.boxShadow = "0 4px 20px rgba(197,160,89,0.3)"; }}
            >
              {laden ? (
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "0.5rem" }}>
                  <div style={{ width: 16, height: 16, border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                  {t.login.loading}
                </span>
              ) : (
                <span>{modus === "anmelden" ? t.login.signIn : t.login.signUp}</span>
              )}
            </button>
          </form>
        </div>

        {/* Features */}
        <div style={{
          display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: "0.75rem",
          width: "100%",
        }}>
          {features.map((f, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.1, duration: 0.4 }}
              style={{
                padding: "1rem 0.75rem",
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.05)",
                borderRadius: 0, textAlign: "center",
              }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: 0,
                background: "rgba(197,160,89,0.08)",
                display: "flex", alignItems: "center", justifyContent: "center",
                margin: "0 auto 0.5rem",
              }}>
                <f.icon size={18} style={{ color: "#c5a059" }} />
              </div>
              <div style={{ fontSize: "0.75rem", fontWeight: 700, color: "#d4d4d8", marginBottom: "0.2rem" }}>{f.label}</div>
              <div style={{ fontSize: "0.625rem", color: "#52525b", lineHeight: 1.4 }}>{f.desc}</div>
            </motion.div>
          ))}
        </div>

        {/* Footer */}
        <p style={{ fontSize: "0.6875rem", color: "#27272a", margin: 0 }}>
          OpenCognit v1.0 — {isGerman ? "Das Betriebssystem für autonome KI-Unternehmen" : "The operating system for autonomous AI companies"}
        </p>
      </motion.div>

    </div>
  );
}
