type StepHeaderProps = {
  documentTitle: string;
  stepLabel: string;
  status?: string;
  children?: React.ReactNode;
};

export function StepHeader({
  documentTitle,
  stepLabel,
  status,
  children,
}: Readonly<StepHeaderProps>) {
  return (
    <header className="step-header">
      <div>
        <p className="step-header__document">{documentTitle}</p>
        <p className="step-header__step">{stepLabel}</p>
      </div>
      <div className="step-header__actions">
        {status ? <span className="step-header__status">{status}</span> : null}
        {children}
      </div>
    </header>
  );
}
