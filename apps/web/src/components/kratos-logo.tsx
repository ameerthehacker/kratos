import LogoMark from "@/assets/kratos-logo.svg?react";

/** The Kratos mark + wordmark, from the owner's design (D38). */
export function KratosLogo() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark width={24} height={24} aria-hidden="true" />
      <span className="font-heading text-lg font-bold tracking-tight">kratos</span>
    </span>
  );
}
