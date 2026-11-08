/** Product catalogue: create, rename, (de)activate, change prices, import from Excel, archive. */

import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { reportsApi } from "@/modules/reports/api";
import { uk, formatCurrency, formatMoney, parseCents } from "@/modules/reports/i18n";
import type { AdminSectionProps } from "@/platform/modules";
import { Card, CardHeader, CardTitle, CardContent } from "@/ui/Card";
import { LedgerSection } from "@/ui/LedgerSection";
import { Button } from "@/ui/Button";
import { Input } from "@/ui/Input";
import { AnimatedCollapse } from "@/ui/AnimatedCollapse";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/ui/Dialog";
import { Plus, Search, Upload, ChevronDown, ChevronUp, History, Archive, RotateCcw, Trash2 } from "lucide-react";

const normalize = (v: string) =>
  String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");

export default function ProductsSection({ notify }: AdminSectionProps) {
  const queryClient = useQueryClient();

  // ----------------------------------------------------
  // PRODUCTS TAB STATE
  // ----------------------------------------------------
  const [productSearch, setProductSearch] = useState("");
  const [createProductOpen, setCreateProductOpen] = useState(false);
  const [newProductName, setNewProductName] = useState("");
  const [newProductPrice, setNewProductPrice] = useState("");

  const [expandedPriceId, setExpandedPriceId] = useState<number | null>(null);
  const [priceInput, setPriceInput] = useState<Record<number, string>>({});
  const [nameInput, setNameInput] = useState<Record<number, string>>({});
  const [activeInput, setActiveInput] = useState<Record<number, boolean>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");

  // Queries
  const { data: productsData, isLoading: productsLoading } = useQuery({
    queryKey: ["adminProducts"],
    queryFn: () => reportsApi.products(),
  });

  const products = useMemo(() => productsData || [], [productsData]);

  // Mutations - Products
  const createProductMutation = useMutation({
    mutationFn: (data: { name: string; price: string }) =>
      reportsApi.createProduct(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminProducts"] });
      setNewProductName("");
      setNewProductPrice("");
      setCreateProductOpen(false);
      notify("Товар успішно додано.");
    },
    onError: (err: Error) => notify(err.message || "Не вдалося додати товар.", "err"),
  });

  const updateProductMutation = useMutation({
    mutationFn: (data: { id: number; name: string; price: string; active: boolean }) =>
      reportsApi.updateProduct(data.id, { name: data.name, price: data.price, active: data.active }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminProducts"] });
      notify("Зміни товару збережено.");
    },
    onError: (err: Error) => notify(err.message || "Не вдалося зберегти товар.", "err"),
  });

  const updatePriceMutation = useMutation({
    mutationFn: (data: { id: number; price: string }) =>
      reportsApi.updateProductPrice(data.id, data.price),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["adminProducts"] });
      setPriceInput((prev) => ({ ...prev, [updated.id]: formatMoney(updated.price_cents) }));
      notify("Ціну оновлено. Історію за цей місяць збережено.");
    },
    onError: (err: Error) => notify(err.message || "Не вдалося зберегти ціну.", "err"),
  });

  const deleteProductMutation = useMutation({
    mutationFn: (id: number) => reportsApi.deleteProduct(id),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["adminProducts"] });
      notify(res?.message || "Товар видалено або архівовано.");
    },
    onError: (err: Error) => notify(err.message || "Не вдалося видалити товар.", "err"),
  });

  const restoreProductMutation = useMutation({
    mutationFn: (id: number) => reportsApi.restoreProduct(id),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["adminProducts"] });
      notify(res?.message || "Товар відновлено.");
    },
    onError: (err: Error) => notify(err.message || "Не вдалося відновити товар.", "err"),
  });

  const importProductsMutation = useMutation({
    mutationFn: (formData: FormData) =>
      reportsApi.importProducts(formData),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["adminProducts"] });
      if (fileInputRef.current) fileInputRef.current.value = "";
      setFileName("");
      notify(res?.message || "Імпорт товарів завершено.");
    },
    onError: (err: Error) => notify(err.message || "Не вдалося імпортувати товари.", "err"),
  });

  // Confirmation modal dialog state
  const [confirmModal, setConfirmModal] = useState<{
    open: boolean;
    title: string;
    description: string;
    actionLabel: string;
    variant: "destructive" | "primary";
    onConfirm: () => void;
  }>({
    open: false,
    title: "",
    description: "",
    actionLabel: "",
    variant: "primary",
    onConfirm: () => {},
  });

  // Initialize input buffers when products/stores load
  useEffect(() => {
    if (products.length > 0) {
      const pMap: Record<number, string> = {};
      const nMap: Record<number, string> = {};
      const aMap: Record<number, boolean> = {};
      products.forEach((p) => {
        pMap[p.id] = formatMoney(p.price_cents);
        nMap[p.id] = p.name;
        aMap[p.id] = p.active;
      });
      setPriceInput((prev) => ({ ...pMap, ...prev }));
      setNameInput((prev) => ({ ...nMap, ...prev }));
      setActiveInput((prev) => ({ ...aMap, ...prev }));
    }
  }, [products]);

  // Filter products by search query
  const queryNormalized = normalize(productSearch);
  const filteredProducts = products.filter((p) => {
    if (!queryNormalized) return true;
    const nameMatch = normalize(nameInput[p.id] || p.name).includes(queryNormalized);
    return nameMatch;
  });

  const activeProducts = filteredProducts.filter((p) => !p.archived && p.active);
  const inactiveProducts = filteredProducts.filter((p) => !p.archived && !p.active);
  const archivedProducts = filteredProducts.filter((p) => p.archived);

  return (
    <>
        <div className="space-y-6">
          {/* Action bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-text-muted pointer-events-none" />
              <Input
                value={productSearch}
                onChange={(e) => setProductSearch(e.target.value)}
                placeholder="Пошук товарів за назвою…"
                className="pl-9 h-11"
              />
            </div>

            <div className="flex items-center space-x-2 shrink-0">
              <Button
                variant="primary"
                className="min-h-[44px]"
                onClick={() => setCreateProductOpen(!createProductOpen)}
              >
                <Plus className="h-4 w-4 mr-1.5" />
                {createProductOpen ? "Скасувати" : "Створити товар"}
              </Button>
            </div>
          </div>

          {/* Create Product Form Foldout */}
          <AnimatedCollapse open={createProductOpen}>
            <div className="pt-1 pb-1">
              <Card className="border-t-2 border-t-primary">
                <CardHeader className="p-4 sm:p-5 border-b border-border">
                  <CardTitle className="text-base">Новий товар</CardTitle>
                </CardHeader>
                <CardContent className="p-4 sm:p-5">
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (!newProductName.trim() || !newProductPrice.trim()) return;
                      createProductMutation.mutate({
                        name: newProductName.trim(),
                        price: newProductPrice.trim(),
                      });
                    }}
                    className="flex flex-col sm:flex-row items-stretch sm:items-end gap-3"
                  >
                    <div className="flex-1 space-y-1.5">
                      <label className="block text-xs font-medium text-text-muted">Назва товару</label>
                      <Input
                        value={newProductName}
                        onChange={(e) => setNewProductName(e.target.value)}
                        placeholder="Введіть назву товару"
                        maxLength={100}
                        required
                        className="h-11"
                      />
                    </div>

                    <div className="w-full sm:w-40 space-y-1.5">
                      <label className="block text-xs font-medium text-text-muted">Ціна (грн)</label>
                      <Input
                        value={newProductPrice}
                        onChange={(e) => setNewProductPrice(e.target.value)}
                        placeholder="0.00"
                        inputMode="decimal"
                        required
                        className="h-11 font-mono"
                      />
                    </div>

                    <Button
                      type="submit"
                      className="min-h-[44px] shrink-0"
                      disabled={createProductMutation.isPending}
                    >
                      {createProductMutation.isPending ? "Додаю…" : "Додати товар"}
                    </Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          </AnimatedCollapse>

          {/* Excel Import Card */}
          <section aria-labelledby="products-import-title" className="border-l-2 border-border pl-4">
            <h2 id="products-import-title" className="flex items-center gap-2 font-sans text-[0.9375rem] font-medium text-text-main">
              <Upload className="h-4 w-4 text-primary" aria-hidden="true" />
              Імпорт товарів з Excel
            </h2>
            <div className="mt-2">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!fileInputRef.current?.files?.[0]) return;
                  const fd = new FormData();
                  fd.append("file", fileInputRef.current.files[0]);
                  importProductsMutation.mutate(fd);
                }}
                className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3"
              >
                {/* The native file control renders in the browser's language; this label replaces its look. */}
                <label className="flex flex-1 min-h-[44px] cursor-pointer items-center gap-3 rounded-control border border-border bg-surface p-1 pr-3 focus-within:border-primary focus-within:ring-1 focus-within:ring-primary">
                  <input
                    ref={fileInputRef}
                    type="file"
                    name="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    required
                    className="sr-only"
                    onChange={(e) => setFileName(e.target.files?.[0]?.name ?? "")}
                  />
                  <span className="rounded-control bg-surface-raised px-4 py-2 text-sm font-medium text-text-main">Обрати файл</span>
                  <span className={`truncate text-sm ${fileName ? "text-text-main" : "text-text-muted"}`}>
                    {fileName || "Файл не обрано"}
                  </span>
                </label>
                <Button
                  type="submit"
                  variant="outline"
                  className="min-h-[44px] shrink-0"
                  disabled={importProductsMutation.isPending}
                >
                  {importProductsMutation.isPending ? "Імпортую…" : "Імпортувати товари"}
                </Button>
              </form>
              <p className="text-xs text-text-muted mt-2">
                Файл .xlsx: у колонці A назва, у колонці B ціна. Товари з назвою, що вже є, пропускаються.
              </p>
            </div>
          </section>

          {/* Active Products List */}
          <LedgerSection
            id="products-active"
            title={`Активні товари (${activeProducts.length})`}
            actions={productsLoading ? <span className="text-sm text-text-muted">Завантаження…</span> : undefined}
          >
            <div className="divide-y divide-border">
              {activeProducts.length === 0 ? (
                <div className="px-1 py-8 text-sm text-text-muted">
                  {productSearch ? "Товарів за запитом не знайдено." : "Активних товарів немає."}
                </div>
              ) : (
                activeProducts.map((p) => {
                  const isPriceOpen = expandedPriceId === p.id;
                  const currentEditName = nameInput[p.id] ?? p.name;
                  const currentEditActive = activeInput[p.id] ?? p.active;
                  const currentEditPrice = priceInput[p.id] ?? formatMoney(p.price_cents);

                  const hasNameOrActiveChanged =
                    currentEditName.trim() !== p.name || currentEditActive !== p.active;

                  const enteredCents = parseCents(currentEditPrice);
                  const hasPriceChanged =
                    isPriceOpen && !isNaN(enteredCents) && enteredCents !== p.price_cents;

                  return (
                    <div key={p.id} data-product-id={p.id} className="px-1 py-4">
                      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                        {/* Name & Active toggle */}
                        <div className="flex-1 flex flex-col sm:flex-row sm:items-center gap-3">
                          <Input
                            value={currentEditName}
                            onChange={(e) =>
                              setNameInput((prev) => ({ ...prev, [p.id]: e.target.value }))
                            }
                            className="font-medium h-11"
                            maxLength={100}
                          />

                          <label className="flex items-center space-x-2 text-xs text-text-muted shrink-0 cursor-pointer min-h-[44px]">
                            <input
                              type="checkbox"
                              checked={currentEditActive}
                              onChange={(e) =>
                                setActiveInput((prev) => ({ ...prev, [p.id]: e.target.checked }))
                              }
                              className="h-4 w-4 rounded border-border text-primary"
                            />
                            <span>Активний</span>
                          </label>
                        </div>

                        {/* Price toggle & metadata */}
                        <div className="flex items-center space-x-3 shrink-0">
                          <span className="hidden w-20 text-xs text-text-muted sm:inline">
                            У звітах: {p.used_count}
                          </span>

                          <button
                            type="button"
                            onClick={() => setExpandedPriceId(isPriceOpen ? null : p.id)}
                            className="flex min-h-[44px] w-[12.5rem] items-center justify-between gap-2 rounded-control border border-border bg-surface px-3 py-2 text-sm font-medium transition-colors hover:border-text-muted/50"
                            aria-expanded={isPriceOpen}
                          >
                            <span className="figure flex-1 text-left font-semibold text-text-main">
                              {formatCurrency(p.price_cents)}
                            </span>
                            <span className="text-xs text-text-muted">
                              {isPriceOpen ? "Закрити" : "Змінити"}
                            </span>
                            {isPriceOpen ? (
                              <ChevronUp className="h-4 w-4 text-text-muted" />
                            ) : (
                              <ChevronDown className="h-4 w-4 text-text-muted" />
                            )}
                          </button>

                          {hasNameOrActiveChanged && (
                            <Button
                              size="sm"
                              variant="primary"
                              className="min-h-[44px] animate-scale-in"
                              disabled={updateProductMutation.isPending}
                              onClick={() =>
                                updateProductMutation.mutate({
                                  id: p.id,
                                  name: currentEditName.trim(),
                                  price: formatMoney(p.price_cents),
                                  active: currentEditActive,
                                })
                              }
                            >
                              Зберегти
                            </Button>
                          )}

                          <Button
                            size="icon"
                            variant="ghost"
                            className="text-destructive hover:bg-destructive/10 min-h-[44px] min-w-[44px]"
                            title="Видалити / В архів"
                            onClick={() => {
                              const isUsed = p.used_count > 0;
                              setConfirmModal({
                                open: true,
                                title: isUsed ? "Перемістити товар в архів?" : "Видалити товар?",
                                description: isUsed
                                  ? `«${p.name}» є у звітах (${p.used_count} рядків). Товар буде архівовано, дані звітів залишаться.`
                                  : `«${p.name}» не використовується у звітах. Видалити остаточно?`,
                                actionLabel: isUsed ? "В архів" : "Видалити",
                                variant: "destructive",
                                onConfirm: () => deleteProductMutation.mutate(p.id),
                              });
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      {/* Price Editor Foldout */}
                      <AnimatedCollapse open={isPriceOpen}>
                        <div className="mt-4 space-y-3 border-l-2 border-primary bg-surface-raised/60 p-4">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-center space-x-2">
                              <label className="text-xs font-medium text-text-muted whitespace-nowrap">
                                Нова ціна за одиницю:
                              </label>
                              <div className="relative w-36">
                                <Input
                                  value={currentEditPrice}
                                  onChange={(e) =>
                                    setPriceInput((prev) => ({ ...prev, [p.id]: e.target.value }))
                                  }
                                  inputMode="decimal"
                                  className="h-10 pr-7 font-mono font-bold"
                                />
                                <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-text-muted">
                                  ₴
                                </span>
                              </div>
                            </div>

                            <Button
                              size="sm"
                              variant="primary"
                              className="min-h-[40px] transition-all"
                              disabled={!hasPriceChanged || updatePriceMutation.isPending}
                              onClick={() =>
                                updatePriceMutation.mutate({
                                  id: p.id,
                                  price: currentEditPrice,
                                })
                              }
                            >
                              Зберегти ціну
                            </Button>
                          </div>

                          {/* Price History Chips */}
                          {(() => {
                            const monthPrices = p.month_prices_cents || [];
                            if (monthPrices.length === 0) return null;
                            const displayPrices =
                              monthPrices.length > 2
                                ? [monthPrices[0], monthPrices[monthPrices.length - 1]]
                                : monthPrices;
                            return (
                              <div className="space-y-1.5 pt-1">
                                <div className="text-[0.6875rem] font-semibold text-text-muted flex items-center space-x-1">
                                  <History className="h-3 w-3" />
                                  <span>Історія ціни у поточному місяці:</span>
                                </div>
                                <div className="flex flex-wrap gap-1.5">
                                  {displayPrices.map((price, idx) => {
                                    const isLast = idx === displayPrices.length - 1;
                                    return (
                                      <span
                                        key={idx}
                                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-mono tabular-nums ${
                                          isLast
                                            ? "bg-primary/10 text-primary border border-primary/30 font-semibold"
                                            : "bg-surface border border-border text-text-muted"
                                        }`}
                                      >
                                        {formatCurrency(price)}
                                        <span className="ml-1 text-[0.625rem] font-normal font-sans opacity-75">
                                          {displayPrices.length === 1
                                            ? "увесь місяць"
                                            : idx === 0
                                            ? "до зміни"
                                            : "зараз"}
                                        </span>
                                      </span>
                                    );
                                  })}
                                </div>
                              </div>
                            );
                          })()}

                          <p className="text-[0.6875rem] text-text-muted">
                            Кожна зміна зберігається окремо. У звітах цього місяця будуть усі
                            використані ціни; з наступного місяця залишиться остання.
                          </p>
                        </div>
                      </AnimatedCollapse>
                    </div>
                  );
                })
              )}
            </div>
          </LedgerSection>

          {/* Inactive Products List */}
          {inactiveProducts.length > 0 && (
            <LedgerSection id="products-inactive" title={`Неактивні товари (${inactiveProducts.length})`}>
              <div className="divide-y divide-border">
                {inactiveProducts.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-4 px-1 py-3">
                    <div>
                      <div className="font-medium text-text-muted">{p.name}</div>
                      <div className="text-xs text-text-muted mt-0.5">
                        Ціна <span className="figure">{formatCurrency(p.price_cents)}</span>, у звітах: {p.used_count}
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="min-h-[44px]"
                        onClick={() =>
                          updateProductMutation.mutate({
                            id: p.id,
                            name: p.name,
                            price: formatMoney(p.price_cents),
                            active: true,
                          })
                        }
                      >
                        Активувати
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive hover:bg-destructive/10 min-h-[44px] min-w-[44px]"
                        onClick={() => {
                          const isUsed = p.used_count > 0;
                          setConfirmModal({
                            open: true,
                            title: isUsed ? "Перемістити товар в архів?" : "Видалити товар?",
                            description: isUsed
                              ? `«${p.name}» є у звітах (${p.used_count} рядків). Товар буде архівовано.`
                              : `«${p.name}» не використовується у звітах. Видалити остаточно?`,
                            actionLabel: isUsed ? "В архів" : "Видалити",
                            variant: "destructive",
                            onConfirm: () => deleteProductMutation.mutate(p.id),
                          });
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </LedgerSection>
          )}

          {/* Archived Products Section */}
          {archivedProducts.length > 0 && (
            <details className="group border-t border-border">
              <summary className="flex min-h-[48px] cursor-pointer list-none items-center gap-2 px-1 text-sm font-medium text-text-muted [&::-webkit-details-marker]:hidden">
                <Archive className="h-4 w-4" aria-hidden="true" />
                <span>Архів товарів ({archivedProducts.length})</span>
              </summary>
              <div className="divide-y divide-border border-l-2 border-border pl-3">
                {archivedProducts.map((p) => (
                  <div key={p.id} className="flex items-center justify-between gap-4 py-3">
                    <span className="text-sm text-text-muted">{p.name}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-[44px]"
                      onClick={() => restoreProductMutation.mutate(p.id)}
                    >
                      <RotateCcw className="h-4 w-4 mr-1.5" />
                      Відновити
                    </Button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>

      {/* Confirmation Modal Dialog */}
      <Dialog
        open={confirmModal.open}
        onOpenChange={(open) => setConfirmModal((prev) => ({ ...prev, open }))}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{confirmModal.title}</DialogTitle>
            <DialogDescription>{confirmModal.description}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setConfirmModal((prev) => ({ ...prev, open: false }))}
            >
              {uk.store.cancelButton}
            </Button>
            <Button
              variant={confirmModal.variant}
              onClick={() => {
                confirmModal.onConfirm();
                setConfirmModal((prev) => ({ ...prev, open: false }));
              }}
            >
              {confirmModal.actionLabel}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
