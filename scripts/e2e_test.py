# /// script
# requires-python = ">=3.10"
# dependencies = ["playwright"]
# ///
"""Browser smoke test: drives the real app (store clerk on mobile, admin on desktop).

Usage:  go build -o dist/legkyi ./cmd/server   (after `npm run build` in frontend/)
        CHROMIUM_PATH=/opt/pw-browsers/chromium uv run scripts/e2e_test.py
LEGKYI_E2E_BINARY overrides the binary path (default dist/legkyi).
"""
import os
import time
import shutil
import subprocess
import tempfile
from pathlib import Path
from playwright.sync_api import sync_playwright

def dismiss_first_login_dialogs(pg):
    """The first sign-in on a device opens, one after the other, the biometric offer ("Не зараз") and the device
    setup (notifications / install, "Пізніше"). Decline each until none is left; at least one must have appeared."""
    seen = 0
    for _ in range(6):
        try:
            pg.wait_for_selector('[role="dialog"]', state="visible", timeout=1500 if seen else 5000)
        except Exception:
            break
        dialog = pg.get_by_role("dialog")
        for name in ("Не зараз", "Пізніше"):
            btn = dialog.get_by_role("button", name=name)
            if btn.count():
                btn.first.click()
                seen += 1
                break
        else:
            raise AssertionError("an unexpected dialog is open after sign-in")
        pg.wait_for_timeout(300)
    assert seen, "no first-login dialog appeared"
    pg.wait_for_selector('[role="dialog"]', state="detached", timeout=5000)


def desk_product_request(pg, query, product, deceased, quantity):
    """A desk orders a product on the «Продукція» tab, leaving the car to the dispatcher."""
    pg.goto("http://127.0.0.1:8888/admin/transport?tab=products")
    pg.click('button:has-text("Нова заявка")')
    dialog = pg.get_by_role("dialog")
    box = dialog.get_by_role("combobox", name="Товар")
    box.fill(query)
    dialog.locator('[role="listbox"]:visible [role="option"]', has_text=product).click()
    for _ in range(quantity - 1):
        dialog.get_by_role("button", name=f"Збільшити кількість: {product}").click()
    dialog.locator("#request-deceased").fill(deceased)
    assert dialog.get_by_role("combobox", name="Бажане авто").input_value() == ""
    dialog.get_by_role("button", name="Надіслати").click()
    pg.wait_for_selector("text=Заявку надіслано", timeout=5000)
    pg.wait_for_selector(f'article:has-text("{deceased}") >> text=Надіслано', timeout=5000)


def run_tests():
    test_dir = tempfile.mkdtemp(prefix="legkyi_test_")
    print(f"Using isolated test directory: {test_dir}")

    env = os.environ.copy()
    env["LEGKYI_DATA_DIR"] = test_dir
    env["ADMIN_PASSWORD"] = "Admin123pass"
    env["DEMO"] = "1"
    env["AUTO_UPDATE"] = "0"  # a stamped CI build must never update itself during a test
    env["COOKIE_SECURE"] = "0"
    env["HOST"] = "127.0.0.1"
    env["PORT"] = "8888"
    env["TUNNEL_ENABLED"] = "0"  # The app's optional .env loader must not enable a real tunnel in tests.

    # The binary runs in the throwaway folder so a repository .env cannot point its data or backups
    # at the real ones.
    root = Path(__file__).resolve().parents[1]
    go_binary = os.getenv("LEGKYI_E2E_BINARY") or str(root / "dist" / "legkyi")
    env["LEGKYI_BACKUPS_DIR"] = os.path.join(test_dir, "backups")
    command, workdir = [os.path.abspath(go_binary)], test_dir
    server_process = subprocess.Popen(
        command,
        cwd=workdir,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    time.sleep(2)
    console_errors = []

    try:
        with sync_playwright() as p:
            # CHROMIUM_PATH lets the script reuse an already-installed browser instead of `playwright install`.
            browser = p.chromium.launch(headless=True, executable_path=os.getenv("CHROMIUM_PATH") or None)

            # -------------------------------------------------------------
            # 1. Store Clerk Flow (Mobile viewport 390x844)
            # -------------------------------------------------------------
            print("\n--- 1. Testing Store Clerk Flow at 390x844 ---")
            context = browser.new_context(viewport={"width": 390, "height": 844})
            page = context.new_page()

            def on_console(msg):
                if msg.type == "error":
                    # Filter out expected 401 when first visiting /login unauthenticated or logging out
                    if "401" in msg.text:
                        return
                    console_errors.append(f"[{msg.type}] {msg.text}")
                    print(f"Browser console [{msg.type}]: {msg.text}")

            page.on("console", on_console)
            page.on("pageerror", lambda err: console_errors.append(f"[pageerror] {err}"))

            def on_response(resp):
                # Refused API calls are printed with their body: the first thing to read when a step times out.
                if "/api/" in resp.url and resp.status >= 400 and not (resp.status == 401 and resp.url.endswith("/session")):
                    try:
                        body = resp.text()[:300]
                    except Exception:
                        body = ""
                    print(f"  [api {resp.status}] {resp.request.method} {resp.url} {body}")

            page.on("response", on_response)

            page.goto("http://127.0.0.1:8888/login")
            page.wait_for_load_state("networkidle")
            print("Login page title:", page.title())

            # Fill login form
            page.fill('#login-username', "store1")
            page.fill('#login-password', "Store1-demo")
            page.click('button[type="submit"]')

            # Wait for navigation to /report
            page.wait_for_url("**/report", timeout=5000)
            print("Successfully navigated to:", page.url)

            # The first password sign-in on a device offers biometric sign-in; decline it
            dismiss_first_login_dialogs(page)
            print("Biometric offer shown and declined")

            # The report opens on today's day: a strip of the month's days, today's chip pressed
            page.wait_for_selector('text=Яблука, кг', timeout=5000)
            today_chip = page.locator('[role="group"][aria-label="Дні місяця"] button[aria-pressed="true"]')
            assert "сьогодні" in (today_chip.get_attribute("aria-label") or ""), "the report must open on today"
            print("Store report loaded on today's day with products!")

            # Verify store name
            header_text = page.inner_text("header")
            print("Header store name:", header_text)
            assert "Підрозділ 1" in header_text

            # Test quantity stepper (+ button)
            plus_buttons = page.locator('button[aria-label^="Збільшити кількість"]').all()
            print(f"Found {len(plus_buttons)} increment buttons")
            assert len(plus_buttons) >= 3
            plus_buttons[0].click()
            time.sleep(0.5)

            # Check unsaved changes badge
            assert page.locator('text=Є незбережені зміни').count() > 0
            print("Unsaved changes indicator appeared!")

            # Save draft
            save_draft_btn = page.locator('footer button:has-text("Зберегти чернетку")')
            print("Clicking save draft...")
            save_draft_btn.click()
            page.wait_for_selector('text=Чернетку дня збережено', timeout=5000)
            print("Draft saved confirmed!")

            # Submit the day
            submit_btn = page.locator('footer button:has-text("Надіслати день")')
            print("Clicking submit report...")
            submit_btn.click()

            # Confirm dialog
            page.wait_for_selector('[role="dialog"]', timeout=3000)
            confirm_btn = page.locator('[role="dialog"] button:has-text("Так, надіслати")')
            confirm_btn.click()

            page.wait_for_selector('text=Звіт за день надіслано й заблоковано', timeout=5000)
            print("Submit confirmed and locked!")
            assert "Надіслав(ла): store1" in page.inner_text("main"), "the page must name the employee who submitted"
            print("Report is signed by the submitting employee!")

            # Verify inputs are now disabled
            first_input = page.locator('input[inputmode="numeric"]').first
            assert first_input.is_disabled(), "Quantity input should be disabled after submission"
            print("Verified report is read-only after submission.")

            # The month as a whole is a reviewer's view: the store has no «Місяць» in the strip
            assert page.locator('[role="group"][aria-label="Дні місяця"] button', has_text="Місяць").count() == 0
            print("Store sees days only!")

            # Transport desk: the same user places an order for today
            page.click('a[aria-label="Транспорт"]')
            page.wait_for_url("**/admin/transport", timeout=5000)
            page.click('button:has-text("Нове замовлення")')
            page.fill('#order-deceased', "Тестовий Т. Т.")
            # The car is a required pick from the fleet. DEMO seeds four cars and books АА 1234 ВВ for the demo
            # orders at 09:30, so the desk searches for a free one by a part of its plate (Latin letters work too).
            page.fill('#order-car', "ka 0101")
            page.locator('[role="listbox"]:visible [role="option"]', has_text="КА 0101 КК").click()
            page.fill('#delivery-departure', "вул. Квітуча, 5")
            page.fill('#delivery-time', "0930")
            page.fill('#delivery-destination', "Морг №1")
            page.click('[role="dialog"] button:has-text("Надіслати")')
            page.wait_for_selector('text=Замовлення надіслано', timeout=5000)
            page.wait_for_selector('article:has-text("Тестовий Т. Т.")', timeout=5000)
            assert page.locator('article:has-text("Тестовий Т. Т.") >> text=Надіслано').count() > 0
            print("Desk placed a transport order!")

            # Product requests without a car: one to load onto the order above, one for a goods run
            desk_product_request(page, "ябл", "Яблука, кг", "Тестовий Т. Т.", 2)
            desk_product_request(page, "хлі", "Хліб", "Рейс А", 1)
            print("Desk sent two product requests!")

            # Logout through the account menu
            page.locator('button[aria-label^="Обліковий запис"]:visible').first.click()
            page.get_by_role("menuitem", name="Вийти").click()
            page.wait_for_url("**/login", timeout=5000)
            print("Successfully logged out!")
            context.close()

            # The second desk orders milk for the same run
            desk2 = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True)
            page2 = desk2.new_page()
            page2.on("console", on_console)
            page2.on("pageerror", lambda err: console_errors.append(f"[pageerror] {err}"))
            page2.on("response", on_response)
            page2.goto("http://127.0.0.1:8888/login")
            page2.fill('#login-username', "store2")
            page2.fill('#login-password', "Store2-demo")
            page2.click('button[type="submit"]')
            page2.wait_for_url("**/report", timeout=5000)
            dismiss_first_login_dialogs(page2)
            desk_product_request(page2, "мол", "Молоко, 1 л", "Рейс Б", 3)
            desk2.close()
            print("Second desk sent a product request!")

            # -------------------------------------------------------------
            # 2. Admin Flow (Desktop viewport 1280x800)
            # -------------------------------------------------------------
            print("\n--- 2. Testing Admin Flow at 1280x800 ---")
            admin_context = browser.new_context(viewport={"width": 1280, "height": 800})
            admin_page = admin_context.new_page()
            admin_page.on("console", on_console)
            admin_page.on("pageerror", lambda err: console_errors.append(f"[pageerror] {err}"))
            admin_page.on("response", on_response)

            admin_page.goto("http://127.0.0.1:8888/login")
            admin_page.wait_for_load_state("networkidle")
            admin_page.fill('#login-username', "admin")
            admin_page.fill('#login-password', "Admin123pass")
            admin_page.click('button[type="submit"]')

            admin_page.wait_for_url("**/admin/**", timeout=5000)
            print("Admin landed on:", admin_page.url)
            dismiss_first_login_dialogs(admin_page)
            admin_page.wait_for_selector('text=Товари за день', timeout=5000)
            print("Admin review page opened on the day tab")

            # Dispatcher answers the desk's transport order
            admin_page.goto("http://127.0.0.1:8888/admin/transport")
            admin_page.wait_for_selector('article:has-text("Тестовий Т. Т.")', timeout=5000)
            admin_page.locator('article:has-text("Тестовий Т. Т.") button:has-text("Прийняти")').click()
            admin_page.fill('#status-note', "Авто виїде о 8:40")
            admin_page.click('[role="dialog"] button:has-text("Застосувати")')
            admin_page.wait_for_selector('article:has-text("Тестовий Т. Т.") >> text=Авто виїде о 8:40', timeout=5000)
            print("Dispatcher replied to the transport order!")
            admin_page.locator('article:has-text("демо 1") button:has-text("Призначити носіїв")').click()
            admin_page.fill('[role="dialog"] input[aria-label="Носій 1"]', "Петренко О.")
            admin_page.click('[role="dialog"] button:has-text("Зберегти")')
            admin_page.wait_for_selector('article:has-text("демо 1") >> text=Петренко О.', timeout=5000)
            admin_page.click('a:has-text("Схема виносу")')
            admin_page.wait_for_url("**/admin/transport/schedule**", timeout=5000)
            admin_page.wait_for_selector('tr:has-text("демо 1") >> text=Петренко О.', timeout=5000)
            print("Dispatcher assigned bearers and the schedule shows them!")

            # Dispatcher loads desk 1's request onto the order that already goes there
            admin_page.goto("http://127.0.0.1:8888/admin/transport?tab=board")
            unplanned = admin_page.locator("#unplanned")
            unplanned.locator('article:has-text("Тестовий Т. Т.")').get_by_role("button", name="Додати до рейсу").click()
            dialog = admin_page.get_by_role("dialog")
            dialog.locator("label", has_text="Тестовий Т. Т.").locator('input[type="radio"]').check()
            dialog.get_by_role("textbox", name="Кількість: Яблука, кг").fill("2")
            dialog.get_by_role("button", name="Завантажити").click()
            admin_page.wait_for_selector("text=Вантаж додано", timeout=5000)
            lane = admin_page.get_by_role("region", name="КА 0101 КК")
            lane.locator('li:has-text("Тестовий Т. Т.")').get_by_role("region", name="Вантаж").get_by_text("Яблука, кг").wait_for(timeout=5000)
            print("Dispatcher loaded the request onto the desk's order; the manifest shows it!")

            # A goods run over both desks, with each stop's lines picked from that desk's requests
            admin_page.get_by_role("button", name="Новий рейс").first.click()
            dialog = admin_page.get_by_role("dialog", name="Новий рейс")
            dialog.locator("#run-car").fill("зсу")
            dialog.locator('[role="listbox"]:visible [role="option"]', has_text="ЗСУ1234").click()
            dialog.locator("#run-time").fill("1500")
            dialog.get_by_label("Зупинка 1: підрозділ").select_option(label="Підрозділ 1")
            dialog.get_by_role("combobox", name="Додати товар із заявок (1)").click()
            dialog.locator('[role="listbox"]:visible [role="option"]', has_text="Хліб").click()
            dialog.get_by_role("button", name="Додати зупинку").click()
            dialog.get_by_label("Зупинка 2: підрозділ").select_option(label="Підрозділ 2")
            dialog.get_by_role("combobox", name="Додати товар із заявок (2)").click()
            dialog.locator('[role="listbox"]:visible [role="option"]', has_text="Молоко").click()
            dialog.get_by_role("button", name="Зберегти").click()
            admin_page.wait_for_selector("text=Рейс збережено", timeout=5000)
            run_row = admin_page.get_by_role("region", name="ЗСУ1234").locator('li[aria-label^="Рейс"]')
            manifest = run_row.get_by_role("region", name="Вантаж")
            manifest.get_by_text("Хліб").wait_for(timeout=5000)
            stops = manifest.locator("ol > li").all_inner_texts()
            assert len(stops) == 2 and "Підрозділ 1" in stops[0] and "Підрозділ 2" in stops[1] and "Молоко" in stops[1], stops
            assert admin_page.locator('#unplanned article').count() == 0, "every request should be planned now"
            print("Goods run over two desks created; the manifest lists each stop in route order!")
            admin_page.goto("http://127.0.0.1:8888/admin/reports")
            admin_page.wait_for_load_state("networkidle")

            # Download XLSX test
            xlsx_link = admin_page.locator('a[href*="/admin/summary.xlsx"]')
            print("Found XLSX export link:", xlsx_link.get_attribute("href"))

            # Navigate to Reports
            admin_page.click('a:visible:has-text("Звіти")')
            admin_page.wait_for_url("**/admin/reports**", timeout=5000)
            admin_page.wait_for_selector('text=Підрозділ 1', timeout=5000)
            print("Navigated to Reports list, store 1 card visible")

            # Check store1 report card and click into detail
            report_card = admin_page.locator('a:has-text("Підрозділ 1")').first
            report_card.click()
            admin_page.wait_for_url("**/admin/reports/**", timeout=5000)
            admin_page.wait_for_selector('text=Підрозділ 1', timeout=5000)
            print("Navigated to Report Detail:", admin_page.url)
            # The month is kept by days: open the day the store submitted
            # (yesterday is already closed by the midnight close at start, marked «не надіслано вчасно»)
            admin_page.locator('[role="group"][aria-label="Дні місяця"] button[aria-label*="сьогодні"]').first.click()
            admin_page.wait_for_url("**day=**", timeout=5000)
            admin_page.wait_for_selector('text=Надіслав(ла): store1', timeout=5000)
            print("Admin sees who submitted the day!")

            # Unlock the day
            admin_page.locator('button:has-text("Розблокувати день")').click()
            admin_page.locator('[role="dialog"] button:has-text("Розблокувати день")').click()
            admin_page.wait_for_selector('text=День розблоковано', timeout=5000)
            print("Day unlocked successfully!")

            # The month page narrowed to one day
            admin_page.goto("http://127.0.0.1:8888/admin/reports")
            admin_page.get_by_role("combobox", name="День для перегляду").select_option(index=0)
            admin_page.wait_for_selector('text=Товари за день', timeout=5000)
            assert "day=" in (admin_page.locator('a[href*="/admin/summary.xlsx"]').get_attribute("href") or "")
            # The midnight close at start marked yesterday as missed for both demo stores (same month unless today is the 1st)
            if time.strftime("%d") != "01":
                admin_page.wait_for_selector('section#missed >> text=Підрозділ 2', timeout=5000)
                print("Missed days are listed for the reviewer!")
            admin_page.get_by_role("tab", name="За місяць").click()
            admin_page.wait_for_selector('text=Товари за місяць', timeout=5000)
            assert "period=" in (admin_page.locator('a[href*="/admin/summary.xlsx"]').get_attribute("href") or "")
            admin_page.locator('a:has-text("Підрозділ 1")').first.click()
            admin_page.wait_for_selector('text=Звіт за місяць лише для перегляду', timeout=5000)
            assert admin_page.locator('button:has-text("Заблокувати звіт"), button:has-text("Розблокувати звіт")').count() == 0
            print("Day and month tabs work; the month report is read-only!")

            # Administration hub -> products (a section contributed by the reports module)
            admin_page.click('aside a:has-text("Адміністрування")')
            admin_page.wait_for_url("**/admin/manage", timeout=5000)
            admin_page.wait_for_selector('text=Облікові записи', timeout=5000)
            admin_page.locator('a:visible:has-text("Товари й ціни")').first.click()
            admin_page.wait_for_url("**/admin/manage/products", timeout=5000)
            admin_page.wait_for_selector('button:has-text("Створити товар")', timeout=5000)
            print("Navigated to the products section of the administration hub")

            # Add a new product
            admin_page.click('button:has-text("Створити товар")')
            admin_page.wait_for_selector('input[placeholder*="Введіть назву"]', timeout=3000)
            admin_page.fill('input[placeholder*="Введіть назву"]', "Тестовий Чай")
            admin_page.fill('input[placeholder*="0.00"]', "45.00")
            admin_page.click('button:has-text("Додати товар")')
            admin_page.wait_for_selector('text=Товар успішно додано', timeout=5000)
            print("Product creation succeeded!")

            # Filter products by search
            admin_page.fill('input[placeholder*="Пошук"]', "Тестовий Чай")
            time.sleep(0.5)

            # Locate the filtered product row
            prod_row = admin_page.locator('[data-product-id]').first
            assert prod_row.locator('input[maxlength="100"]').input_value() == "Тестовий Чай"
            print("Filtered product row verified!")

            # Test Price edit
            change_price_btn = prod_row.locator('button:has-text("Змінити")')
            change_price_btn.click()
            time.sleep(0.5)

            price_input = prod_row.locator('input[inputmode="decimal"]')
            assert price_input.input_value() == "45.00"
            price_input.fill("55.00")
            time.sleep(0.5)

            save_price_btn = prod_row.locator('button:has-text("Зберегти ціну")')
            assert save_price_btn.is_enabled()
            save_price_btn.click()
            admin_page.wait_for_selector('text=Ціну оновлено', timeout=5000)
            print("Price update verified!")

            # Audit log section of the hub
            admin_page.locator('nav[aria-label="Розділи адміністрування"] a:visible:has-text("Журнал дій")').first.click()
            admin_page.wait_for_url("**/admin/manage/audit", timeout=5000)
            admin_page.wait_for_selector('text=Тестовий Чай', timeout=5000)
            print("Navigated to Logs. Total logs rows:", admin_page.locator("#audit-entries li").count())
            assert admin_page.locator("text=Тестовий Чай").count() > 0, "Audit log should mention the created product"
            print("Audit log entry verified!")

            admin_context.close()
            browser.close()

    finally:
        server_process.terminate()
        server_process.wait()
        if os.path.exists(test_dir):
            shutil.rmtree(test_dir, ignore_errors=True)

    print("\n--- Summary of Console Errors ---")
    if console_errors:
        print(f"Total console issues: {len(console_errors)}")
        for err in console_errors:
            print("  ", err)
        assert len(console_errors) == 0, "Found unexpected console errors"
    else:
        print("ZERO console errors!")

if __name__ == "__main__":
    run_tests()
