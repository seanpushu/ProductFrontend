import { useState } from "react";
import { formatPrice, type Product } from "./api";

export function ProductCard({ product }: { product: Product }) {
  const [imageFailed, setImageFailed] = useState(false);
  const showImage = product.image_url && !imageFailed;

  return (
    <article className="card">
      {showImage ? (
        <img
          className="card-image"
          src={product.image_url!}
          alt={product.name}
          loading="lazy"
          onError={() => setImageFailed(true)}
        />
      ) : (
        <div className="card-image placeholder" role="img" aria-label={`No image available for ${product.name}`}>
          <span aria-hidden="true">No image</span>
        </div>
      )}
      <div className="card-body">
        <h2 className="card-title">{product.name}</h2>
        {product.description && <p className="card-description">{product.description}</p>}
        <p className="price">{formatPrice(product.price_cents, product.currency)}</p>
      </div>
    </article>
  );
}
