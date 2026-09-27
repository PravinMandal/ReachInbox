import { useTheme } from "../lib/theme.js";
import { cn } from "../lib/cn.js";

/**
 * Animated sun/moon toggle. The glyph cross-fades + rotates on switch
 * (CSS transition, no JS animation lib needed).
 */
export function ThemeToggle({ className = "" }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const dark = theme === "dark";
  return (
    <button
      onClick={(e) => toggle({ clientX: e.clientX, clientY: e.clientY })}
      title={dark ? "Switch to light mode" : "Switch to dark mode"}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      className={cn(
        "relative grid h-9 w-9 place-items-center overflow-hidden rounded-full",
        "text-neutral-500 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800",
        "transition-colors",
        className,
      )}
    >
      {/* Sun — visible in light, rotates/scales out in dark */}
      <span
        aria-hidden
        className={cn(
          "absolute text-lg leading-none transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
          dark ? "-rotate-90 scale-0 opacity-0" : "rotate-0 scale-100 opacity-100",
        )}
      >
        ☀
      </span>
      {/* Moon — reverse */}
      <span
        aria-hidden
        className={cn(
          "absolute text-lg leading-none transition-all duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)]",
          dark ? "rotate-0 scale-100 opacity-100" : "rotate-90 scale-0 opacity-0",
        )}
      >
        ☾
      </span>
    </button>
  );
}
