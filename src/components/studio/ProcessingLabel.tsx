/** A stable text label with decorative opacity waves and no frame-driven renders. */
export default function ProcessingLabel({children}: {children: string}) {
 const label = children.replace(/(?:\.{3}|…)$/, '');
 return <span className="processing-label">
  <span>{label}</span>
  <span className="processing-dots" aria-hidden="true"><span>.</span><span>.</span><span>.</span></span>
 </span>;
}
