export function Avatar({ name, src, size = 36 }: { name: string; src?: string | null; size?: number }) {
  if (src) return <img src={src} alt={name} width={size} height={size} className="rounded-full object-cover" />;
  const initial = name.trim().charAt(0).toUpperCase() || "O";
  return (
    <span
      className="inline-flex items-center justify-center rounded-full bg-green-500 font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.42 }}
      aria-hidden
    >
      {initial}
    </span>
  );
}
