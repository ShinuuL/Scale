export function Avatar({
  name,
  speaking = false
}: {
  name: string;
  speaking?: boolean;
}) {
  return <span className={`l-avatar ${speaking ? 'is-speaking' : ''}`}>
    {name.slice(0, 1)}
  </span>;
}
