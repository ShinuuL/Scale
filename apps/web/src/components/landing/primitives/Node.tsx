export function Node({
  name
}: {
  name: string;
}) {
  return <div className="l-node">
    <span className="l-node-dot" />
    <span>
      {name}
    </span>
  </div>;
}
