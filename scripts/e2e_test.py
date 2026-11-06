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
            page.get_by_role("dialog").get_by_role("button", name="Не зараз").click()
            page.wait_for_selector('[role="dialog"]', state="detached", timeout=5000)
            print("Biometric offer shown and declined")

            # Wait for report items to load
            page.wait_for_selector('text=Яблука, кг', timeout=5000)
            print("Store report loaded with products!")

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
            page.wait_for_selector('text=Чернетку збережено', timeout=5000)
            print("Draft saved confirmed!")

            # Submit report
            submit_btn = page.locator('footer button:has-text("Надіслати звіт")')
            print("Clicking submit report...")
            submit_btn.click()

            # Confirm dialog
            page.wait_for_selector('[role="dialog"]', timeout=3000)
            confirm_btn = page.locator('[role="dialog"] button:has-text("Так, надіслати")')
            confirm_btn.click()

            page.wait_for_selector('text=Звіт надіслано й заблоковано', timeout=5000)
            print("Submit confirmed and locked!")
            assert "Надіслав(ла): store1" in page.inner_text("main"), "the page must name the employee who submitted"
            print("Report is signed by the submitting employee!")

            # Verify inputs are now disabled
            first_input = page.locator('input[inputmode="numeric"]').first
            assert first_input.is_disabled(), "Quantity input should be disabled after submission"
            print("Verified report is read-only after submission.")

            # Transport desk: the same user places an order for today
            page.click('a[aria-label="Транспорт"]')
            page.wait_for_url("**/admin/transport", timeout=5000)
            page.click('button:has-text("Нове замовлення")')
            page.fill('#order-deceased', "Тестовий Т. Т.")
            page.fill('#delivery-car', "АА 0001 АА")
            page.fill('#delivery-departure', "вул. Квітуча, 5")
            page.fill('#delivery-time', "0930")
            page.fill('#delivery-destination', "Морг №1")
            page.click('[role="dialog"] button:has-text("Надіслати")')
            page.wait_for_selector('text=Замовлення надіслано', timeout=5000)
            page.wait_for_selector('article:has-text("Тестовий Т. Т.")', timeout=5000)
            assert page.locator('article:has-text("Тестовий Т. Т.") >> text=Надіслано').count() > 0
            print("Desk placed a transport order!")

            # Logout through the account menu
            page.locator('button[aria-label^="Обліковий запис"]:visible').first.click()
            page.get_by_role("menuitem", name="Вийти").click()
            page.wait_for_url("**/login", timeout=5000)
            print("Successfully logged out!")
            context.close()

            # -------------------------------------------------------------
            # 2. Admin Flow (Desktop viewport 1280x800)
            # -------------------------------------------------------------
            print("\n--- 2. Testing Admin Flow at 1280x800 ---")
            admin_context = browser.new_context(viewport={"width": 1280, "height": 800})
            admin_page = admin_context.new_page()
            admin_page.on("console", on_console)
            admin_page.on("pageerror", lambda err: console_errors.append(f"[pageerror] {err}"))

            admin_page.goto("http://127.0.0.1:8888/login")
            admin_page.wait_for_load_state("networkidle")
            admin_page.fill('#login-username', "admin")
            admin_page.fill('#login-password', "Admin123pass")
            admin_page.click('button[type="submit"]')

            admin_page.wait_for_url("**/admin/**", timeout=5000)
            print("Admin landed on:", admin_page.url)
            admin_page.get_by_role("dialog").get_by_role("button", name="Не зараз").click()
            admin_page.wait_for_selector('[role="dialog"]', state="detached", timeout=5000)
            admin_page.wait_for_selector('text=Товари за місяць', timeout=5000)
            print("Admin month view loaded")

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
            admin_page.wait_for_selector('text=Надіслав(ла): store1', timeout=5000)
            print("Admin sees who submitted the report!")

            # Unlock report
            unlock_btn = admin_page.locator('button:has-text("Розблокувати")')
            if unlock_btn.count() > 0:
                print("Clicking unlock report...")
                unlock_btn.click()
                confirm_unlock = admin_page.locator('[role="dialog"] button:has-text("Розблокувати")')
                confirm_unlock.click()
                admin_page.wait_for_selector('text=Звіт розблоковано', timeout=5000)
                print("Report unlocked successfully!")

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
