import { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api/client";
import type { ProductDTO, StoreDTO, ImportResultDTO, MessageDTO, MutationDTO } from "@/api/types";
import { uk, formatCurrency, formatMoney, parseCents } from "@/i18n/uk";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/Dialog";
import {
  Package,
  Store,
  Shield,
  Globe,
  Database,
  Plus,
  Search,
  Upload,
  Download,
  AlertCircle,
  CheckCircle,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  History,
  Archive,
  RotateCcw,
  Trash2,
  KeyRound,
} from "lucide-react";

interface TunnelStatus {
  enabled: boolean;
  autostart: boolean;
  has_token?: boolean;
  state: string;
  public_url: string;
  login_url: string;
  error: string;
}

const normalize = (v: string) =>
  String(v || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");

export default function AdminSettingsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();

  const currentTab = searchParams.get("tab") || "products";

  const setTab = (tab: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("tab", tab);
    setSearchParams(next);
  };

  const [feedback, setFeedback] = useState<{ text: string; kind: "ok" | "err" } | null>(null);

  const notify = (text: string, kind: "ok" | "err" = "ok") => {
    setFeedback({ text, kind });
  };

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

  // ----------------------------------------------------
  // STORES TAB STATE
  // ----------------------------------------------------
  const [createStoreOpen, setCreateStoreOpen] = useState(false);
  const [newStoreName, setNewStoreName] = useState("");
  const [newStoreLogin, setNewStoreLogin] = useState("");
  const [newStorePassword, setNewStorePassword] = useState("");

  const [storeNameInput, setStoreNameInput] = useState<Record<number, string>>({});
  const [storeLoginInput, setStoreLoginInput] = useState<Record<number, string>>({});
  const [storePasswordInput, setStorePasswordInput] = useState<Record<number, string>>({});

  const { data: storesData, isLoading: storesLoading } = useQuery({
    queryKey: ["adminStores"],
    queryFn: () => api.get<StoreDTO[]>("/api/v1/admin/stores"),
  });

  const stores = useMemo(() => storesData || [], [storesData]);

  const createStoreMutation = useMutation({
    mutationFn: (data: { name: string; login: string; password: string }) =>
      api.post<StoreDTO>("/api/v1/admin/stores", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminStores"] });
      setNewStoreName("");
      setNewStoreLogin("");
      setNewStorePassword("");
      setCreateStoreOpen(false);
      notify("Магазин успішно створено.");
    },
    onError: (err: Error) => notify(err.message || "Не вдалося створити магазин.", "err"),
  });

  const updateStoreMutation = useMutation({
    mutationFn: (data: { id: number; name: string; login: string }) =>
      api.put<StoreDTO>(`/api/v1/admin/stores/${data.id}`, { name: data.name, login: data.login }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["adminStores"] });
      notify("Дані магазину оновлено.");
    },
    onError: (err: Error) => notify(err.message || "Не вдалося оновити магазин.", "err"),
  });

  const resetStorePasswordMutation = useMutation({
    mutationFn: (data: { id: number; password: string }) =>
      api.put<MessageDTO>(`/api/v1/admin/stores/${data.id}/password`, { password: data.password }),
    onSuccess: (_, vars) => {
      setStorePasswordInput((prev) => ({ ...prev, [vars.id]: "" }));
      notify("Пароль магазину успішно змінено.");
    },
    onError: (err: Error) => notify(err.message || "Не вдалося змінити пароль.", "err"),
  });

  const deleteStoreMutation = useMutation({
    mutationFn: (id: number) => api.delete<MutationDTO>(`/api/v1/admin/stores/${id}`),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["adminStores"] });
      notify(res?.message || "Магазин видалено або архівовано.");
    },
    onError: (err: Error) => notify(err.message || "Не вдалося видалити магазин.", "err"),
  });

  const restoreStoreMutation = useMutation({
    mutationFn: (id: number) => api.post<MutationDTO>(`/api/v1/admin/stores/${id}/restore`),
    onSuccess: (res) => {
      queryClient.invalidateQueries({ queryKey: ["adminStores"] });
      notify(res?.message || "Магазин відновлено.");
    },
    onError: (err: Error) => notify(err.message || "Не вдалося відновити магазин.", "err"),
  });

  // ----------------------------------------------------
  // SECURITY TAB STATE
  // ----------------------------------------------------
  const [adminNewPassword, setAdminNewPassword] = useState("");

  const changeAdminPasswordMutation = useMutation({
    mutationFn: (password: string) =>
      api.put<MessageDTO>("/api/v1/admin/password", { password }),
    onSuccess: (res) => {
      setAdminNewPassword("");
      notify(res?.message || "Пароль адміністратора оновлено.");
    },
    onError: (err: Error) => notify(err.message || "Не вдалося змінити пароль.", "err"),
  });

  // ----------------------------------------------------
  // TUNNEL TAB STATE
  // ----------------------------------------------------
  const [tunnelAuthKey, setTunnelAuthKey] = useState("");
  const [confirmPublic, setConfirmPublic] = useState(false);

  const { data: tunnelData } = useQuery({
    queryKey: ["adminTunnel"],
    queryFn: () => api.get<TunnelStatus>("/api/v1/admin/tunnel"),
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      if (state === "starting") return 1500;
      if (currentTab === "tunnel") return 3000;
      return false;
    },
  });

  const tunnel = tunnelData || {
    enabled: false,
    autostart: false,
    state: "disabled",
    public_url: "",
    login_url: "",
    error: "",
  };

  const isTunnelActive = ["starting", "running", "authentication-required", "stopping"].includes(
    tunnel.state
  );

  const startTunnelMutation = useMutation({
    mutationFn: () =>
      api.post<TunnelStatus>("/api/v1/admin/tunnel", {
        confirm_public: true,
        autostart: true,
        auth_key: tunnelAuthKey.trim() || null,
      }),
    onSuccess: (res) => {
      setTunnelAuthKey("");
      queryClient.setQueryData(["adminTunnel"], res);
      notify("Запуск тунелю запитано.");
    },
    onError: (err: Error) => notify(err.message || "Не вдалося запустити тунель.", "err"),
  });

  const stopTunnelMutation = useMutation({
    mutationFn: () => api.delete<TunnelStatus>("/api/v1/admin/tunnel"),
    onSuccess: (res) => {
      queryClient.setQueryData(["adminTunnel"], res);
      notify("Тунель відключено.");
    },
    onError: (err: Error) => notify(err.message || "Не вдалося вимкнути тунель.", "err"),
  });

  const setTunnelAutostartMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      api.put<TunnelStatus>("/api/v1/admin/tunnel/autostart", { enabled }),
    onSuccess: (res) => {
      queryClient.setQueryData(["adminTunnel"], res);
      notify(
        res.autostart ? "Автозапуск тунелю увімкнено." : "Автозапуск тунелю вимкнено."
      );
    },
    onError: (err: Error) => notify(err.message || "Не вдалося змінити автозапуск.", "err"),
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

  useEffect(() => {
    if (stores.length > 0) {
      const nMap: Record<number, string> = {};
      const lMap: Record<number, string> = {};
      stores.forEach((s) => {
        nMap[s.id] = s.name;
        lMap[s.id] = s.login;
      });
      setStoreNameInput((prev) => ({ ...nMap, ...prev }));
      setStoreLoginInput((prev) => ({ ...lMap, ...prev }));
    }
  }, [stores]);

  const tabs = [
    { id: "products", label: uk.settings.tabs.products, icon: Package },
    { id: "stores", label: uk.settings.tabs.stores, icon: Store },
    { id: "security", label: uk.settings.tabs.security, icon: Shield },
    { id: "tunnel", label: uk.settings.tabs.tunnel, icon: Globe },
    { id: "backup", label: uk.settings.tabs.backup, icon: Database },
  ];

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

  const activeStores = stores.filter((s) => !s.archived);
  const archivedStores = stores.filter((s) => s.archived);

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-text-main">{uk.settings.title}</h1>
        <p className="text-sm text-text-muted mt-1">
          Керування каталогом товарів, магазинами, доступом та безпекою
        </p>
      </div>

      {/* Navigation Tabs */}
      <div className="flex border-b border-border overflow-x-auto space-x-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setTab(tab.id)}
              className={`flex items-center px-4 py-3 text-sm font-medium border-b-2 whitespace-nowrap transition-colors min-h-[44px] ${
                isActive
                  ? "border-primary text-primary font-semibold"
                  : "border-transparent text-text-muted hover:text-text-main hover:border-border"
              }`}
            >
              <Icon className="h-4 w-4 mr-2 shrink-0" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Global Alert / Feedback */}
      {feedback && (
        <div
          role="status"
          aria-live="polite"
          className={`p-4 rounded-card border flex items-center justify-between text-sm ${
            feedback.kind === "ok"
              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-600 dark:text-emerald-400"
              : "bg-destructive/10 border-destructive/20 text-destructive"
          }`}
        >
          <div className="flex items-center space-x-2">
            {feedback.kind === "ok" ? (
              <CheckCircle className="h-5 w-5 shrink-0" />
            ) : (
              <AlertCircle className="h-5 w-5 shrink-0" />
            )}
            <span>{feedback.text}</span>
          </div>
          <button
            type="button"
            className="text-text-muted hover:text-text-main p-1 rounded min-h-[44px] min-w-[44px] flex items-center justify-center"
            onClick={() => setFeedback(null)}
            aria-label="Закрити"
          >
            ×
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 1: PRODUCTS                                                           */}
      {/* ========================================================================= */}
      {currentTab === "products" && (
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
          {createProductOpen && (
            <Card className="border-primary/40 bg-page/30">
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
          )}

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
                              className="min-h-[44px]"
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
                      {isPriceOpen && (
                        <div className="mt-4 pt-4 border-t border-border/80 bg-page/40 p-4 rounded-control space-y-3">
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
                              className="min-h-[40px]"
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
                      )}
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
      )}

      {/* ========================================================================= */}
      {/* TAB 2: STORES                                                             */}
      {/* ========================================================================= */}
      {currentTab === "stores" && (
        <div className="space-y-6 animate-fade-in">
          <div className="flex justify-between items-center">
            <p className="text-sm text-text-muted">
              Зміна назви чи логіну не впливає на вже подані звіти. Пароль змінюється окремо.
            </p>
            <Button
              variant="primary"
              className="min-h-[44px]"
              onClick={() => setCreateStoreOpen(!createStoreOpen)}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              {createStoreOpen ? "Скасувати" : "Створити магазин"}
            </Button>
          </div>

          {/* Create Store Foldout */}
          {createStoreOpen && (
            <Card className="border-primary/40 bg-page/30">
              <CardHeader className="p-4 sm:p-5 border-b border-border">
                <CardTitle className="text-base">Новий магазин</CardTitle>
              </CardHeader>
              <CardContent className="p-4 sm:p-5">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!newStoreName.trim() || !newStoreLogin.trim() || !newStorePassword.trim()) {
                      return;
                    }
                    createStoreMutation.mutate({
                      name: newStoreName.trim(),
                      login: newStoreLogin.trim(),
                      password: newStorePassword.trim(),
                    });
                  }}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-text-muted">Назва магазину</label>
                      <Input
                        value={newStoreName}
                        onChange={(e) => setNewStoreName(e.target.value)}
                        placeholder="Центральний"
                        maxLength={100}
                        required
                        className="h-11"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-text-muted">Логін для входу</label>
                      <Input
                        value={newStoreLogin}
                        onChange={(e) => setNewStoreLogin(e.target.value)}
                        placeholder="store_center"
                        maxLength={40}
                        autoCapitalize="none"
                        required
                        className="h-11 font-mono"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-text-muted">
                        Пароль (від 6 симв.)
                      </label>
                      <Input
                        type="password"
                        value={newStorePassword}
                        onChange={(e) => setNewStorePassword(e.target.value)}
                        placeholder="••••••••"
                        minLength={6}
                        required
                        className="h-11"
                      />
                    </div>
                  </div>

                  <div className="flex justify-end">
                    <Button
                      type="submit"
                      variant="primary"
                      className="min-h-[44px]"
                      disabled={createStoreMutation.isPending}
                    >
                      {createStoreMutation.isPending ? "Створюю…" : "Додати магазин"}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          )}

          {/* Active Stores List */}
          <Card>
            <CardHeader className="p-4 sm:p-5 border-b border-border">
              <CardTitle className="text-base flex items-center justify-between">
                <span>Список активних магазинів ({activeStores.length})</span>
                {storesLoading && <span className="text-xs text-text-muted">Завантаження…</span>}
              </CardTitle>
            </CardHeader>
            <div className="divide-y divide-border">
              {activeStores.length === 0 ? (
                <div className="p-8 text-center text-text-muted text-sm">
                  Магазинів ще немає. Додайте перший магазин.
                </div>
              ) : (
                activeStores.map((s) => {
                  const currentEditName = storeNameInput[s.id] ?? s.name;
                  const currentEditLogin = storeLoginInput[s.id] ?? s.login;
                  const currentNewPassword = storePasswordInput[s.id] ?? "";

                  const hasChanges =
                    currentEditName.trim() !== s.name || currentEditLogin.trim() !== s.login;

                  return (
                    <div key={s.id} className="p-4 sm:p-5 space-y-4 hover:bg-page/20 transition-colors">
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                        {/* Name & Login Edit */}
                        <div className="flex-1 grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="text-[11px] text-text-muted block mb-1">
                              Назва магазину
                            </label>
                            <Input
                              value={currentEditName}
                              onChange={(e) =>
                                setStoreNameInput((prev) => ({ ...prev, [s.id]: e.target.value }))
                              }
                              className="h-11 font-medium"
                              maxLength={100}
                            />
                          </div>

                          <div>
                            <label className="text-[11px] text-text-muted block mb-1">
                              Логін
                            </label>
                            <Input
                              value={currentEditLogin}
                              onChange={(e) =>
                                setStoreLoginInput((prev) => ({ ...prev, [s.id]: e.target.value }))
                              }
                              className="h-11 font-mono"
                              maxLength={40}
                              autoCapitalize="none"
                            />
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center space-x-2 shrink-0 self-end md:self-center">
                          <span className="text-xs text-text-muted mr-2">
                            Звітів: {s.reports_count}
                          </span>

                          {hasChanges && (
                            <Button
                              size="sm"
                              variant="primary"
                              className="min-h-[44px]"
                              disabled={updateStoreMutation.isPending}
                              onClick={() =>
                                updateStoreMutation.mutate({
                                  id: s.id,
                                  name: currentEditName.trim(),
                                  login: currentEditLogin.trim(),
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
                            title="Видалити або перемістити в архів"
                            onClick={() => {
                              const hasReports = s.reports_count > 0;
                              setConfirmModal({
                                open: true,
                                title: hasReports
                                  ? "Перемістити магазин в архів?"
                                  : "Видалити магазин?",
                                description: hasReports
                                  ? `«${s.name}» має звіти (${s.reports_count}). Магазин буде архівовано, звіти залишаться.`
                                  : `«${s.name}» не має звітів. Видалити магазин разом із логіном?`,
                                actionLabel: hasReports ? "В архів" : "Видалити",
                                variant: "destructive",
                                onConfirm: () => deleteStoreMutation.mutate(s.id),
                              });
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </div>

                      {/* Reset password row */}
                      <div className="pt-2 border-t border-border/50 flex flex-col sm:flex-row sm:items-center gap-3">
                        <div className="flex-1 max-w-sm">
                          <Input
                            type="password"
                            placeholder="Новий пароль для цього магазину"
                            value={currentNewPassword}
                            onChange={(e) =>
                              setStorePasswordInput((prev) => ({ ...prev, [s.id]: e.target.value }))
                            }
                            minLength={6}
                            className="h-10 text-xs"
                          />
                        </div>
                        {currentNewPassword.length > 0 && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="min-h-[40px]"
                            disabled={
                              currentNewPassword.length < 6 ||
                              resetStorePasswordMutation.isPending
                            }
                            onClick={() =>
                              resetStorePasswordMutation.mutate({
                                id: s.id,
                                password: currentNewPassword,
                              })
                            }
                          >
                            <KeyRound className="h-3.5 w-3.5 mr-1" />
                            Змінити пароль
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>

          {/* Archived Stores List */}
          {archivedStores.length > 0 && (
            <Card className="border-dashed border-border/80 bg-page/30">
              <CardHeader className="p-4 sm:p-5 border-b border-border">
                <CardTitle className="text-sm font-semibold text-text-muted flex items-center space-x-2">
                  <Archive className="h-4 w-4" />
                  <span>Архів магазинів ({archivedStores.length})</span>
                </CardTitle>
              </CardHeader>
              <div className="divide-y divide-border/60">
                {archivedStores.map((s) => (
                  <div key={s.id} className="p-4 flex items-center justify-between gap-4">
                    <div>
                      <span className="text-sm font-medium text-text-muted line-through">
                        {s.name}
                      </span>
                      <span className="text-xs text-text-muted ml-2">
                        (логін: {s.login} · звітів: {s.reports_count})
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-[44px]"
                      onClick={() => restoreStoreMutation.mutate(s.id)}
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
      )}

      {/* ========================================================================= */}
      {/* TAB 3: SECURITY                                                           */}
      {/* ========================================================================= */}
      {currentTab === "security" && (
        <div className="space-y-6 max-w-2xl animate-fade-in">
          <Card>
            <CardHeader className="p-4 sm:p-5 border-b border-border">
              <CardTitle className="text-base flex items-center space-x-2">
                <Shield className="h-5 w-5 text-primary" />
                <span>{uk.settings.security.title}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 space-y-4">
              <p className="text-sm text-text-muted">
                Введіть новий надійний пароль для облікового запису адміністратора (мінімум 6
                символів).
              </p>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (adminNewPassword.length < 6) return;
                  changeAdminPasswordMutation.mutate(adminNewPassword);
                }}
                className="space-y-4"
              >
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-text-muted">
                    {uk.settings.security.currentAdminPassword}
                  </label>
                  <Input
                    type="password"
                    value={adminNewPassword}
                    onChange={(e) => setAdminNewPassword(e.target.value)}
                    placeholder="Введіть новий пароль"
                    minLength={6}
                    required
                    className="h-11"
                  />
                  <span className="text-xs text-text-muted">{uk.settings.security.minChars}</span>
                </div>

                <Button
                  type="submit"
                  variant="primary"
                  className="min-h-[44px]"
                  disabled={
                    adminNewPassword.length < 6 || changeAdminPasswordMutation.isPending
                  }
                >
                  {changeAdminPasswordMutation.isPending
                    ? uk.common.loading
                    : uk.settings.security.changeButton}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 4: TUNNEL (CLOUDFLARE TUNNEL)                                         */}
      {/* ========================================================================= */}
      {currentTab === "tunnel" && (
        <div className="space-y-6 max-w-2xl animate-fade-in">
          <Card>
            <CardHeader className="p-4 sm:p-5 border-b border-border">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base flex items-center space-x-2">
                  <Globe className="h-5 w-5 text-primary" />
                  <span>{uk.settings.tunnel.title}</span>
                </CardTitle>
                <div className="flex items-center space-x-2">
                  <span
                    className={`h-3 w-3 rounded-full transition-all duration-300 ${
                      tunnel.state === "running"
                        ? "bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.7)]"
                        : tunnel.state === "starting"
                        ? "bg-amber-500 animate-pulse shadow-[0_0_8px_rgba(245,158,11,0.5)]"
                        : "bg-text-muted/40"
                    }`}
                  />
                  <span className="text-xs font-semibold text-text-main">
                    {tunnel.state === "running"
                      ? "Підключено · Активний"
                      : tunnel.state === "starting"
                      ? uk.settings.tunnel.statusStarting
                      : tunnel.state === "stopped"
                      ? uk.settings.tunnel.statusStopped
                      : tunnel.state === "disabled"
                      ? uk.settings.tunnel.statusDisabled
                      : tunnel.state}
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 space-y-5">
              <p className="text-sm text-text-muted">{uk.settings.tunnel.subtitle}</p>

              {tunnel.error && (
                <div className="p-3 rounded-control bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center space-x-2">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{tunnel.error}</span>
                </div>
              )}

              {/* Public link if active */}
              {tunnel.public_url && (
                <div className="p-4 rounded-card bg-primary/10 border border-primary/20 space-y-1">
                  <span className="text-xs font-semibold text-primary block">
                    {uk.settings.tunnel.liveUrl}
                  </span>
                  <a
                    href={tunnel.public_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-base font-bold text-text-main hover:underline flex items-center break-all"
                  >
                    {tunnel.public_url}
                    <ExternalLink className="h-4 w-4 ml-1.5 shrink-0 inline text-primary" />
                  </a>
                </div>
              )}

              {/* Connected without explicit public URL */}
              {tunnel.state === "running" && !tunnel.public_url && (
                <div className="p-4 rounded-card bg-emerald-500/10 border border-emerald-500/20 space-y-1">
                  <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 block">
                    Тунель активний
                  </span>
                  <p className="text-sm text-text-main">
                    З'єднання з Cloudflare встановлено. Публічний доступ працює через налаштований домен тунелю.
                  </p>
                </div>
              )}

              {/* Controls */}
              {isTunnelActive ? (
                <div>
                  <Button
                    variant="destructive"
                    className="min-h-[44px] w-full sm:w-auto"
                    onClick={() => stopTunnelMutation.mutate()}
                    disabled={stopTunnelMutation.isPending}
                  >
                    {stopTunnelMutation.isPending ? "Вимкнення…" : uk.settings.tunnel.stopTunnel}
                  </Button>
                </div>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!confirmPublic) return;
                    startTunnelMutation.mutate();
                  }}
                  className="space-y-4 pt-2"
                >
                  {tunnel.has_token && (
                    <div className="p-3 rounded-control bg-primary/10 border border-primary/20 text-text-main text-xs flex items-center space-x-2">
                      <CheckCircle className="h-4 w-4 text-primary shrink-0" />
                      <span>Токен Cloudflare збережено. Ви можете запустити тунель без повторного введення токена.</span>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <label className="text-xs font-medium text-text-muted">
                      {uk.settings.tunnel.authKeyLabel}
                    </label>
                    <Input
                      type="password"
                      value={tunnelAuthKey}
                      onChange={(e) => setTunnelAuthKey(e.target.value)}
                      placeholder={
                        tunnel.has_token
                          ? "Збережений токен активний (заповніть лише для зміни)"
                          : "Порожньо — швидкий безкоштовний Quick Tunnel"
                      }
                      autoComplete="off"
                      className="h-11"
                    />
                  </div>

                  <label className="flex items-center space-x-2.5 cursor-pointer min-h-[44px] select-none">
                    <input
                      type="checkbox"
                      checked={confirmPublic}
                      onChange={(e) => setConfirmPublic(e.target.checked)}
                      className="h-4 w-4 rounded border-border text-primary"
                    />
                    <span className="text-sm font-medium text-text-main">
                      Підтверджую публічний доступ через тунель
                    </span>
                  </label>

                  <Button
                    type="submit"
                    variant="primary"
                    className="min-h-[44px] w-full sm:w-auto"
                    disabled={!confirmPublic || startTunnelMutation.isPending}
                  >
                    {startTunnelMutation.isPending ? "Підключення…" : uk.settings.tunnel.startTunnel}
                  </Button>
                </form>
              )}

              {/* Autostart preference toggle */}
              <div className="pt-4 border-t border-border flex items-center justify-between">
                <label className="flex items-center space-x-2.5 cursor-pointer min-h-[44px] select-none">
                  <input
                    type="checkbox"
                    checked={Boolean(tunnel.autostart)}
                    onChange={(e) => setTunnelAutostartMutation.mutate(e.target.checked)}
                    disabled={setTunnelAutostartMutation.isPending}
                    className="h-4 w-4 rounded border-border text-primary"
                  />
                  <span className="text-sm text-text-main">
                    {uk.settings.tunnel.autostartToggle}
                  </span>
                </label>
                <span className="text-xs text-text-muted">Оновлюється автоматично</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ========================================================================= */}
      {/* TAB 5: BACKUP                                                             */}
      {/* ========================================================================= */}
      {currentTab === "backup" && (
        <div className="space-y-6 max-w-2xl animate-fade-in">
          <Card>
            <CardHeader className="p-4 sm:p-5 border-b border-border">
              <CardTitle className="text-base flex items-center space-x-2">
                <Database className="h-5 w-5 text-primary" />
                <span>{uk.settings.backup.title}</span>
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 sm:p-6 space-y-5">
              <p className="text-sm text-text-muted">{uk.settings.backup.description}</p>

              <div>
                <a
                  href="/admin/backup/download"
                  download
                  className="inline-flex items-center justify-center rounded-control font-medium transition-colors min-h-[44px] px-5 py-2.5 text-sm bg-primary text-primary-fg hover:opacity-95 shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary w-full sm:w-auto"
                >
                  <Download className="h-4 w-4 mr-2" />
                  {uk.settings.backup.downloadButton}
                </a>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

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
    </div>
  );
}
