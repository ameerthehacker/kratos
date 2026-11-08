import { useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Naming a new feature in place (D73): the sidebar's folder button and the shelf's "New feature…".
 * Enter keeps the name; Esc, or an empty name, cancels; clicking away keeps it only with
 * `keepOnBlur` (Home's shelf: you'll often click into the prompt next, and nothing is made until
 * you send). Its Esc and Enter are its own: not also the session's Esc (stop the agent) or the
 * composer's Enter (send).
 */
export function FeatureNameField(props: {
  icon: LucideIcon;
  placeholder: string;
  keepOnBlur?: boolean;
  onDone: (name: string | null) => void;
  className?: string;
  iconClassName?: string;
  inputClassName?: string;
}) {
  const { icon: Icon, onDone } = props;
  const [name, setName] = useState("");
  // Settles once: Esc closes the field, and a blur as it goes must not then keep the name.
  const settled = useRef(false);
  const settle = (result: string | null) => {
    if (settled.current) return;
    settled.current = true;
    onDone(result);
  };
  return (
    <span className={props.className}>
      <Icon className={cn("shrink-0", props.iconClassName)} aria-hidden="true" />
      <input
        autoFocus
        value={name}
        maxLength={80}
        onChange={(e) => setName(e.target.value)}
        onBlur={() => settle(props.keepOnBlur ? name.trim() || null : null)}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            settle(null);
          }
          if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
          e.preventDefault();
          settle(name.trim() || null);
        }}
        aria-label="New feature name"
        placeholder={props.placeholder}
        className={cn("min-w-0 flex-1 bg-transparent outline-none placeholder:text-faint", props.inputClassName)}
      />
    </span>
  );
}
