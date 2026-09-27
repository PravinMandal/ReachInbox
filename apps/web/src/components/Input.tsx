import { forwardRef, type InputHTMLAttributes } from "react";

/** Ref-forwarding input (react-hook-form compatible). */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input(props, ref) {
    return (
      <input
        ref={ref}
        {...props}
        className={`w-full rounded-xl bg-neutral-100 px-4 py-3 text-sm outline-none placeholder:text-neutral-400 focus:ring-2 focus:ring-green-500 dark:bg-neutral-800 dark:text-neutral-100 ${props.className ?? ""}`}
      />
    );
  },
);
