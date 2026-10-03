/**
 * The logo's chef hat drawn as a small character for "Ask the chef": two eyes that blink and
 * steam that rises (animated in CSS). The logo itself is untouched.
 */
export function ChefMark({ className = "" }: { className?: string }) {
  return (
    <svg className={`chef-mark ${className}`.trim()} viewBox="-4 -8 32 32" aria-hidden="true" focusable="false">
      <g className="chef-steam">
        <path d="M8.6 1.2c-1.3-1.5 1.3-2.6 0-4.2" />
        <path d="M12 -0.6c-1.3-1.5 1.3-2.6 0-4.2" />
        <path d="M15.4 1.2c-1.3-1.5 1.3-2.6 0-4.2" />
      </g>
      <g className="chef-hat">
        <path d="M7 14.5a4 4 0 1 1 1.6-7.7 4 4 0 0 1 6.8 0A4 4 0 1 1 17 14.5V20H7z" />
        <path d="M7 17h10" />
        <g className="chef-eyes">
          <ellipse cx="10" cy="12" rx="0.95" ry="1.3" />
          <ellipse cx="14" cy="12" rx="0.95" ry="1.3" />
        </g>
      </g>
    </svg>
  );
}
