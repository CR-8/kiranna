import { ProductList } from '@/components/product';

/** STOCK / RESTOCK tab: filters, search, scan, add, and the Restock Center. */
export default function Inventory() {
  return <ProductList mode="stock" />;
}
