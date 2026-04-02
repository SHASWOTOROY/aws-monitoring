const companyName =
  import.meta.env.VITE_COMPANY_NAME?.trim() || "Cloudly Infotech Limited";

export function BrandHeader() {
  return (
    <header className="brand-header">
      <div className="brand-header-inner">
        <img
          className="brand-logo"
          src="/logo.png"
          alt=""
          width={52}
          height={52}
          decoding="async"
        />
        <div className="brand-header-text">
          <span className="brand-company">{companyName}</span>
          <span className="brand-product">EC2 utilization</span>
        </div>
      </div>
    </header>
  );
}
