import React, { useState } from "react";
import { useInternalAuth } from "@/lib/InternalAuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Factory, User, Lock, Loader2, ArrowRight, Eye, EyeOff } from "lucide-react";
import { getDefaultRoute } from "@/lib/permissions";

export default function Login() {
  const { login } = useInternalAuth();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const result = await login(username, password);
      if (result.success) {
        window.location.href = getDefaultRoute(result.user);
      } else {
        setError(result.error);
      }
    } catch (err) {
      setError("Usuário ou senha inválidos.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left Branding Panel */}
      <div
        className="hidden lg:flex lg:w-1/2 flex-col justify-center px-16 relative"
        style={{ background: "radial-gradient(circle at 50% 50%, #081125 0%, #0f1c37 100%)" }}
      >
        <div className="max-w-md mx-auto">
          <div className="w-14 h-14 rounded-xl flex items-center justify-center mb-6" style={{ background: "#2563eb" }}>
            <Factory className="w-7 h-7 text-white" strokeWidth={1.5} />
          </div>
          <h1 className="text-4xl font-bold text-white tracking-tight mb-2">ChemControl</h1>
          <p className="text-base text-blue-200/70 font-light mb-6">Controle de Produção Industrial</p>
          <div className="w-24 h-px mb-6" style={{ background: "linear-gradient(to right, #3b82f6, transparent)" }} />
          <p className="text-sm text-blue-100/60 leading-relaxed">
            Sistema integrado de gestão para rastreabilidade, qualidade e controle produtivo da indústria química.
          </p>
        </div>
      </div>

      {/* Right Login Panel */}
      <div className="flex-1 flex flex-col items-center justify-center px-6" style={{ background: "#f8fafc" }}>
        <div className="w-full max-w-sm">
          <div className="mb-8">
            <h2 className="text-2xl font-bold mb-1" style={{ color: "#1e293b" }}>Acessar o Sistema</h2>
            <p className="text-sm" style={{ color: "#94a3b8" }}>Entre com suas credenciais</p>
          </div>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-100 text-red-600 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-1.5">
              <Label htmlFor="username" className="text-sm font-medium" style={{ color: "#1e293b" }}>Usuário</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "#94a3b8" }} />
                <Input
                  id="username"
                  type="text"
                  autoFocus
                  placeholder="seu.usuario"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="pl-10 h-11"
                  style={{ borderColor: "#e2e8f0", color: "#1e293b" }}
                  required
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="password" className="text-sm font-medium" style={{ color: "#1e293b" }}>Senha</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4" style={{ color: "#94a3b8" }} />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-10 pr-10 h-11"
                  style={{ borderColor: "#e2e8f0", color: "#1e293b" }}
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: "#94a3b8" }}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <Button
              type="submit"
              disabled={loading}
              className="w-full h-11 text-white font-medium rounded-lg flex items-center justify-center gap-2"
              style={{ background: "#2563eb" }}
            >
              {loading ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Entrando...</>
              ) : (
                <>Entrar <ArrowRight className="w-4 h-4" /></>
              )}
            </Button>
          </form>

          <p className="text-center text-xs mt-8" style={{ color: "#94a3b8" }}>
            ChemControl © 2026 — Todos os direitos reservados
          </p>
        </div>
      </div>
    </div>
  );
}
