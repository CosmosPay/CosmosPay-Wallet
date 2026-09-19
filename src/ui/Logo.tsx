import '@/styles/ui/logo.css';

/** Isotipo de la marca Cosmos: la C con el trazo que la atraviesa. Es blanco;
    logo.css lo invierte a negro en el tema claro, igual que al PNG viejo. */
export function Logo({ size = 72 }: { size?: number }) {
  return (
    <img
      src={`${import.meta.env.BASE_URL}brand/isotipo.svg`}
      className="brand-logo logo-img"
      width={size}
      height={size}
      alt="Cosmos"
      draggable={false}
    />
  );
}
