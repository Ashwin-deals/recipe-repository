/** Diet tag stamps. With `max`, extra tags collapse into a "+N" stamp (the full list stays readable). */
export function DietTags({ tags, max }: { tags: string[]; max?: number }) {
  if (!tags.length) return null;
  const shown = max === undefined ? tags : tags.slice(0, max);
  const hidden = tags.slice(shown.length);
  return (
    <ul className="diet" aria-label="Diet tags (estimate)">
      {shown.map((tag) => (
        <li key={tag} className="diet-tag" title="Estimate based on ingredients">
          {tag}
        </li>
      ))}
      {hidden.length > 0 && (
        <li className="diet-tag diet-more" title={hidden.join(", ")}>
          <span aria-hidden="true">+{hidden.length}</span>
          <span className="visually-hidden">{hidden.join(", ")}</span>
        </li>
      )}
    </ul>
  );
}
