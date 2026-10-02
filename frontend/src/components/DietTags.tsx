export function DietTags({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <ul className="diet" aria-label="Diet tags (estimate)">
      {tags.map((tag) => (
        <li key={tag} className="diet-tag" title="Estimate based on ingredients">
          {tag}
        </li>
      ))}
    </ul>
  );
}
