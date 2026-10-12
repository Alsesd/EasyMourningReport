(() => {
    "use strict";

    // The controller survives soft tab swaps; duplicate script tags must not bind twice.
    if (window.__easyMourningAdminScriptLoaded) {
        document.dispatchEvent(new CustomEvent("app:page-updated"));
        return;
    }
    window.__easyMourningAdminScriptLoaded = true;

    const normalizeSearch = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().trim().replace(/\s+/g, " ");

    if (location.hash === "#archive") document.getElementById("archive")?.scrollIntoView();

    // Remember foldouts separately; bind newly swapped-in admin pages too.
    const foldoutStorageKey = "easyMourningReport.admin.foldouts.v1";
    let foldoutState = {};
    try {
        foldoutState = JSON.parse(localStorage.getItem(foldoutStorageKey) || "{}") || {};
    } catch (_error) { /* Optional preference. */ }

    function bindFoldouts() {
        [...document.querySelectorAll("details[id], #archive details")].forEach((details, index) => {
            if (details.dataset.foldoutBound === "true") return;
            const key = details.id || (details.closest("#archive") ? "archive-section-" + index : "foldout-" + index);
            if (Object.prototype.hasOwnProperty.call(foldoutState, key)) details.open = !!foldoutState[key];
            details.dataset.foldoutBound = "true";
            details.addEventListener("toggle", () => {
                foldoutState[key] = details.open;
                try { localStorage.setItem(foldoutStorageKey, JSON.stringify(foldoutState)); } catch (_error) { }
            });
        });
    }

    bindFoldouts();

    function centsFromValue(value) {
        const raw = String(value ?? "").trim().replace(/\s/g, "").replace(",", ".");
        if (!raw) return "";
        const amount = Number(raw);
        return Number.isFinite(amount) ? Math.round((amount + Number.EPSILON) * 100) : raw;
    }

    function normalizeFieldValue(el) {
        if (el.name === "price" || el.name === "extra_price") return centsFromValue(el.value);
        return (el.type === "checkbox" || el.type === "radio") ? el.checked : el.value;
    }

    function formSnapshot(form) {
        return [...form.elements]
            .filter(el => el.name && !el.disabled && !["submit", "button", "reset"].includes(el.type))
            .filter(el => !(el.name === "extra_price" && el.value.trim() === ""))
            .map(el => [el.name, normalizeFieldValue(el)]);
    }

    function initializeFormTracking(form) {
        if (!form || !form.matches("form.entry-form")) return;
        form.dataset.originalSnapshot = JSON.stringify(formSnapshot(form));
        form.classList.remove("has-unsaved");
        const submit = form.querySelector('button[type="submit"], button:not([type]), input[type="submit"]');
        if (submit) {
            submit.hidden = true;
            submit.setAttribute("aria-hidden", "true");
        }
    }

    function refreshSaveButton(form) {
        if (!form || !form.matches("form.entry-form")) return;
        const submit = form.querySelector('button[type="submit"], button:not([type]), input[type="submit"]');
        if (!submit || !form.dataset.originalSnapshot) return;
        const changed = JSON.stringify(formSnapshot(form)) !== form.dataset.originalSnapshot;
        submit.hidden = !changed;
        submit.setAttribute("aria-hidden", String(!changed));
        form.classList.toggle("has-unsaved", changed);
        form.closest(".product-entry")?.classList.toggle("has-unsaved", changed);
        let status = form.querySelector(".dirty-status");
        if (changed && !status) { status = document.createElement("span"); status.className = "dirty-status"; status.textContent = "Є незбережені зміни"; status.setAttribute("role", "status"); (form.querySelector(".product-actions") || form).prepend(status); }
        if (!changed) status?.remove();
    }

    document.querySelectorAll("form.entry-form").forEach(initializeFormTracking);

    function priceEditorHasChanges(editor) {
        return [...editor.querySelectorAll('input[name="price"], input[name="extra_price"]')].some(input => {
            const current = normalizeFieldValue(input);
            const original = input.hasAttribute("data-original") ? centsFromValue(input.dataset.original) : "";
            if (input.name === "extra_price" && current === "" && original === "") return false;
            return current !== original;
        });
    }

    function refreshPriceNote(editor) {
        const note = editor.querySelector(".price-note");
        if (!note) return;
        const changed = priceEditorHasChanges(editor);
        note.hidden = !changed;
        if (changed) note.textContent = "Нові ціни діятимуть з " + (document.querySelector("[data-admin-period]")?.dataset.adminPeriod || "") + ". Попередні місяці та вже внесені кількості у звітах не зміняться.";
    }

    function setPriceEditorOpen(button, open) {
        const form = button.closest(".product-form");
        const editor = form && form.querySelector(".price-editor");
        if (!editor) return;

        if (!open && priceEditorHasChanges(editor)) {
            const note = editor.querySelector(".price-note");
            if (note) {
                note.hidden = false;
                note.textContent = "Спочатку збережіть зміни ціни — після цього редактор можна згорнути.";
            }
            const save = form.querySelector(".save-product");
            if (save && !save.hidden) save.focus();
            return;
        }

        button.setAttribute("aria-expanded", String(open));
        const label = button.querySelector(".price-toggle-label > span");
        if (label) label.textContent = open ? "Згорнути варіанти" : "Варіанти ціни";
        if (open) {
            editor.hidden = false;
            editor.inert = false;
            editor.setAttribute("aria-hidden", "false");
            requestAnimationFrame(() => editor.classList.add("is-open"));
            const first = editor.querySelector(".price-option--new input") || editor.querySelector("input");
            if (first) first.focus({ preventScroll: true });
        } else {
            editor.classList.remove("is-open");
            editor.inert = true;
            editor.setAttribute("aria-hidden", "true");
            const delay = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 280;
            window.setTimeout(() => {
                if (!editor.classList.contains("is-open")) editor.hidden = true;
            }, delay);
            button.focus({ preventScroll: true });
        }
    }

    function refreshProductSearch() {
        const query = normalizeSearch(document.getElementById("product-search")?.value);
        document.querySelectorAll(".product-entry").forEach(entry => {
            const name = normalizeSearch(entry.querySelector('input[name="name"]')?.value || entry.dataset.productName);
            entry.hidden = !name.includes(query);
        });
        if (query) {
            document.querySelectorAll(".product-list").forEach(section => {
                if ([...section.querySelectorAll(".product-entry")].some(entry => !entry.hidden)) section.open = true;
            });
        }
    }

    function showProductFeedback(entry, message, kind) {
        entry.querySelector(".product-feedback")?.remove();
        const note = document.createElement("p");
        note.className = "hint product-feedback " + (kind || "good");
        note.setAttribute("role", kind === "err" ? "alert" : "status");
        note.textContent = message;
        const form = entry.querySelector(".product-form");
        if (form) form.insertAdjacentElement("afterend", note);
    }

    function insertProductInNameOrder(section, entry) {
        entry.dataset.productName = (entry.querySelector('input[name="name"]')?.value || "").trim().toLocaleLowerCase();
        const siblings = [...section.querySelectorAll(":scope > .product-entry")].filter(other => other !== entry);
        const before = siblings.find(other => other.dataset.productName.localeCompare(entry.dataset.productName, "uk") > 0);
        section.insertBefore(entry, before || null);
    }

    async function saveProductWithoutReload(form) {
        const entry = form.closest(".product-entry");
        const submit = form.querySelector(".save-product");
        if (!entry || !submit || submit.disabled) return;

        const previousLabel = submit.textContent;
        const previousTop = entry.getBoundingClientRect().top;
        submit.disabled = true;
        submit.textContent = "Зберігаю…";
        entry.setAttribute("aria-busy", "true");
        entry.querySelector(".product-feedback")?.remove();

        try {
            const response = await fetch(form.action, {
                method: "POST",
                body: new FormData(form),
                credentials: "same-origin",
                headers: { "X-Requested-With": "fetch" }
            });
            const html = await response.text();
            const parsed = new DOMParser().parseFromString(html, "text/html");
            const refreshed = parsed.getElementById(entry.id);
            const serverError = parsed.querySelector(".flash.err span")?.textContent.trim();
            const serverMessage = parsed.querySelector(".flash span")?.textContent.trim();

            if (!response.ok || !refreshed || !refreshed.classList.contains("product-entry") || serverError) {
                const message = serverError
                    || parsed.querySelector("main .err")?.textContent.trim()
                    || "Не вдалося зберегти товар. Перевірте значення та спробуйте ще раз.";
                throw new Error(message);
            }

            const parsedSection = refreshed.closest(".product-list");
            const destination = parsedSection && document.getElementById(parsedSection.id);
            const currentSection = entry.closest(".product-list");
            const targetSection = destination || currentSection;
            if (!targetSection) throw new Error("Не вдалося оновити картку товару.");

            entry.remove();
            targetSection.append(refreshed);
            insertProductInNameOrder(targetSection, refreshed);
            targetSection.open = true;
            // Replacing/re-sorting a card must not make the viewport jump.
            const newTop = refreshed.getBoundingClientRect().top;
            window.scrollBy(0, newTop - previousTop);
            initializeFormTracking(refreshed.querySelector("form.product-form"));
            refreshProductSearch();
            refreshed.removeAttribute("aria-busy");
            showProductFeedback(refreshed, serverMessage || "Зміни збережено.", "good");
            // Do not steal focus or scroll after a background save.
        } catch (error) {
            entry.removeAttribute("aria-busy");
            submit.disabled = false;
            submit.textContent = previousLabel;
            const editor = form.querySelector(".price-editor");
            if (editor && editor.hidden) {
                const toggle = form.querySelector(".price-toggle");
                if (toggle) setPriceEditorOpen(toggle, true);
            }
            showProductFeedback(entry, error instanceof Error ? error.message : "Не вдалося зберегти зміни.", "err");
        }
    }

    document.addEventListener("input", event => {
        if (event.target.matches && event.target.matches("#product-search")) refreshProductSearch();
        const form = event.target.closest && event.target.closest("form.entry-form");
        if (form) refreshSaveButton(form);
        const editor = event.target.closest && event.target.closest(".price-editor");
        if (editor) refreshPriceNote(editor);
    });

    document.addEventListener("change", event => {
        const form = event.target.closest && event.target.closest("form.entry-form");
        if (form) refreshSaveButton(form);
        const editor = event.target.closest && event.target.closest(".price-editor");
        if (editor) refreshPriceNote(editor);
    });

    document.addEventListener("reset", event => {
        const form = event.target;
        if (form && form.matches && form.matches("form.entry-form")) {
            requestAnimationFrame(() => refreshSaveButton(form));
        }
    });

    document.addEventListener("click", event => {
        const createButton = event.target.closest && event.target.closest("#show-product-form, #show-store-form");
        if (createButton) {
            const product = createButton.id === "show-product-form";
            const form = document.getElementById(product ? "new-product-form" : "new-store-form");
            if (!form) return;
            const show = form.hidden;
            form.hidden = !show;
            createButton.setAttribute("aria-expanded", String(show));
            createButton.textContent = show ? "Скасувати" : (product ? "＋ Створити товар" : "＋ Створити магазин");
            if (show) form.querySelector('input:not([type="file"])')?.focus({ preventScroll: true });
            return;
        }

        const toggle = event.target.closest && event.target.closest(".price-toggle");
        if (toggle) {
            setPriceEditorOpen(toggle, toggle.getAttribute("aria-expanded") !== "true");
            return;
        }

        const addButton = event.target.closest && event.target.closest(".add-price-btn");
        if (!addButton) return;
        const editor = addButton.closest(".price-editor");
        const container = editor && editor.querySelector(".price-options");
        if (!container) return;

        const option = document.createElement("label");
        option.className = "price-option price-option--new extra-price-field";
        const title = document.createElement("span");
        title.className = "option-label";
        title.textContent = "Нова ціна";
        const field = document.createElement("span");
        field.className = "field price-option-field";
        const input = document.createElement("input");
        input.className = "price";
        input.name = "extra_price";
        input.inputMode = "decimal";
        input.placeholder = "0.00";
        input.setAttribute("aria-label", "Нова ціна");
        const suffix = document.createElement("span");
        suffix.className = "price-option-suffix";
        suffix.textContent = "₴";
        field.append(input, suffix);
        option.append(title, field);
        container.append(option);
        input.focus();
    });

    document.addEventListener("submit", event => {
        const form = event.target;
        if (form && form.matches && form.matches("form.product-form")) {
            event.preventDefault();
            saveProductWithoutReload(form);
        }
    });

    // Partial tab navigation replaces <main> without re-executing this script.
    // Re-initialize controls for the new page; event handlers above are delegated.
    document.addEventListener("app:page-updated", () => {
        bindFoldouts();
        document.querySelectorAll("form.entry-form").forEach(form => {
            if (!form.dataset.originalSnapshot) initializeFormTracking(form);
        });
        refreshProductSearch();
    });
})();
