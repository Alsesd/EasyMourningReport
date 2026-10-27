import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/shared/api/client";
import type { ImportResultDTO, MutationDTO, ProductDTO } from "@/shared/api/types";
import { formatCurrency, formatMoney, parseCents } from "@/shared/i18n/uk";
import { AnimatedCollapse } from "@/shared/components/ui/AnimatedCollapse";
import { Button } from "@/shared/components/ui/Button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/components/ui/Card";
import { Input } from "@/shared/components/ui/Input";
import {
  Archive,
  ChevronDown,
  ChevronUp,
  History,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog";
import type { ConfirmModalState, Notify } from "./types";

const normalize = (v: string) =>
  String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");

interface Props {
  notify: Notify;
}

export default function ProductsSettings({ notify }: Props) {
  const queryClient = useQueryClient();

  const [productSearch, setProductSearch] = useState("");
  const [createProductOpen, setCreateProductOpen] = useState(false);
  const [newProductName, setNewProductName] = useState("");
  const [newProductPrice, setNewProductPrice] = useState("");

  const [expandedPriceId, setExpandedPriceId] = useState<number | null>(null);
  const [priceInput, setPriceInput] = useState<Record<number, string>>({});
  const [nameInput, setNameInput] = useState<Record<number, string>>({});
  const [activeInput, setActiveInput] = useState<Record<number, boolean>>({});

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Queries
  const { data: productsData, isLoading: productsLoading } = useQuery({
    queryKey: ["adminProducts"],
    queryFn: () => api.get<ProductDTO[]>("/api/v1/admin/products"),
  });

  const products = useMemo(() => productsData || [], [productsData]);

  // Mutations - Products
  const createProductMutation = useMutation({
    mutationFn: (data: { name: string; price: string }) =>
      api.post<ProductDTO>("/api/v1/admin/products", data),
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
      api.put<ProductDTO>(`/api/v1/admin/products/${data.id}`, {
        name: data.name,
        price: data.price,
        active: data.active,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminProducts"] });
      notify("Зміни товару збережено.");
    },
    onError: (err: Error) => notify(err.message || "Не вдалося зберегти товар.", "err"),
  });

  const updatePriceMutation = useMutation({
    mutationFn: (data: { id: number; price: string }) =>
      api.put<ProductDTO>(`/api/v1/admin/products/${data.id}/price`, { price: data.price }),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: ["adminProducts"] });
      setPriceInput((prev) => ({ ...prev, [updated.id]: formatMoney(updated.price_cents) }));
      notify("Ціну оновлено. Історію за цей місяць збережено.");
    },
    onError: (err: Error) => notify(err.message || "Не вдалося зберегти ціну.", "err"),
  });

  const deleteProductMutation = useMutation({
    mutationFn: (id: number) => api.delete<MutationDTO>(`/api/v1/admin/products/${id}`),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["adminProducts"] });
      notify(res?.message || "Товар видалено або архівовано.");
    },
    onError: (err: Error) => notify(err.message || "Не вдалося видалити товар.", "err"),
  });

  const restoreProductMutation = useMutation({
    mutationFn: (id: number) => api.post<MutationDTO>(`/api/v1/admin/products/${id}/restore`),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["adminProducts"] });
      notify(res?.message || "Товар відновлено.");
    },
    onError: (err: Error) => notify(err.message || "Не вдалося відновити товар.", "err"),
  });

  const importProductsMutation = useMutation({
    mutationFn: (formData: FormData) =>
      api.upload<ImportResultDTO>("/api/v1/admin/products/import", formData),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["adminProducts"] });
      if (fileInputRef.current) fileInputRef.current.value = "";
      notify(res?.message || "Імпорт товарів завершено.");
    },
    onError: (err: Error) => notify(err.message || "Не вдалося імпортувати товари.", "err"),
  });

  const [confirmModal, setConfirmModal] = useState<ConfirmModalState>({
    open: false,
    title: "",
    description: "",
    actionLabel: "",
    variant: "primary",
    onConfirm: () => {},
  });

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
      <div className="space-y-6 animate-fade-in">
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
            <Card className="border-primary/50 bg-surface/90 shadow-sm backdrop-blur-xs">
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
                    <label className="text-xs font-medium text-text-muted">Назва товару</label>
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
                    <label className="text-xs font-medium text-text-muted">Ціна (грн)</label>
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
        <Card>
          <CardHeader className="p-4 sm:p-5 border-b border-border">
            <CardTitle className="text-sm font-semibold flex items-center space-x-2">
              <Upload className="h-4 w-4 text-primary" />
              <span>Масовий імпорт товарів з Excel (.xlsx)</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 sm:p-5">
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
              <input
                ref={fileInputRef}
                type="file"
                name="file"
                accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                required
                className="flex-1 text-sm text-text-muted file:mr-4 file:py-2 file:px-4 file:rounded-control file:border-0 file:text-sm file:font-medium file:bg-surface file:text-text-main hover:file:bg-page min-h-[44px] border border-border rounded-control p-1 bg-page/40"
              />
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
              Колонка A — назва, колонка B — ціна. Дублікати назв автоматично пропускаються.
            </p>
          </CardContent>
        </Card>

        {/* Active Products List */}
        <Card>
          <CardHeader className="p-4 sm:p-5 border-b border-border">
            <CardTitle className="text-base flex items-center justify-between">
              <span>Активні товари ({activeProducts.length})</span>
              {productsLoading && <span className="text-xs text-text-muted">Завантаження…</span>}
            </CardTitle>
          </CardHeader>
          <div className="divide-y divide-border">
            {activeProducts.length === 0 ? (
              <div className="p-8 text-center text-text-muted text-sm">
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
                  <div key={p.id} data-product-id={p.id} className="p-4 sm:p-5 hover:bg-page/20 transition-colors">
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
                        <span className="text-xs text-text-muted hidden sm:inline">
                          У звітах: {p.used_count}
                        </span>

                        <button
                          type="button"
                          onClick={() => setExpandedPriceId(isPriceOpen ? null : p.id)}
                          className="flex items-center space-x-2 px-3 py-2 rounded-control border border-border bg-page hover:bg-page/70 text-sm font-medium min-h-[44px] transition-colors"
                          aria-expanded={isPriceOpen}
                        >
                          <span className="font-bold tabular-nums font-mono text-text-main">
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
                      <div className="mt-4 pt-4 border-t border-border/80 bg-page/50 p-4 rounded-control space-y-3 shadow-inner/5">
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
                            className="min-h-[40px] shadow-sm transition-all"
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
                              <div className="text-[11px] font-semibold text-text-muted flex items-center space-x-1">
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
                                      <span className="ml-1 text-[10px] font-normal font-sans opacity-75">
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

                        <p className="text-[11px] text-text-muted">
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
        </Card>

        {/* Inactive Products List */}
        {inactiveProducts.length > 0 && (
          <Card className="opacity-80">
            <CardHeader className="p-4 sm:p-5 border-b border-border">
              <CardTitle className="text-base text-text-muted">
                Неактивні товари ({inactiveProducts.length})
              </CardTitle>
            </CardHeader>
            <div className="divide-y divide-border">
              {inactiveProducts.map((p) => (
                <div key={p.id} className="p-4 flex items-center justify-between gap-4">
                  <div>
                    <div className="font-medium text-text-main">{p.name}</div>
                    <div className="text-xs text-text-muted mt-0.5">
                      Ціна: {formatCurrency(p.price_cents)} · У звітах: {p.used_count}
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
          </Card>
        )}

        {/* Archived Products Section */}
        {archivedProducts.length > 0 && (
          <Card className="border-dashed border-border/80 bg-page/30">
            <CardHeader className="p-4 sm:p-5 border-b border-border">
              <CardTitle className="text-sm font-semibold text-text-muted flex items-center space-x-2">
                <Archive className="h-4 w-4" />
                <span>Архів товарів ({archivedProducts.length})</span>
              </CardTitle>
            </CardHeader>
            <div className="divide-y divide-border/60">
              {archivedProducts.map((p) => (
                <div key={p.id} className="p-4 flex items-center justify-between gap-4">
                  <span className="text-sm text-text-muted line-through">{p.name}</span>
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
          </Card>
        )}
      </div>
      <ConfirmDialog
        state={confirmModal}
        onOpenChange={(open) => setConfirmModal((prev) => ({ ...prev, open }))}
      />
    </>
  );
}
