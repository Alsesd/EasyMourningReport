import os
import sys
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
    backend_path = str(Path(__file__).resolve().parents[1] / "backend")
    env["PYTHONPATH"] = backend_path + os.pathsep + env.get("PYTHONPATH", "")
    env["ADMIN_PASSWORD"] = "admin123"
    env["DEMO"] = "1"
    env["COOKIE_SECURE"] = "0"
    env["HOST"] = "127.0.0.1"
    env["PORT"] = "8888"
    env["TUNNEL_ENABLED"] = "0"  # The app's optional .env loader must not enable a real tunnel in tests.
    env["BACKUP_SIDECAR_ENABLED"] = "0"

    server_process = subprocess.Popen(
        [sys.executable, "-m", "app"],
        cwd=backend_path,
        env=env,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    time.sleep(2)
    console_errors = []

    try:
        with sync_playwright() as p:
            browser = p.chromium.launch(headless=True)

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
            page.fill('#login-password', "store1")
            page.click('button[type="submit"]')

            # Wait for navigation to /report
            page.wait_for_url("**/report", timeout=5000)
            print("Successfully navigated to:", page.url)

            # Wait for report items to load
            page.wait_for_selector('text=Яблука, кг', timeout=5000)
            print("Store report loaded with products!")

            # Verify store name
            header_text = page.inner_text("h1")
            print("Header store name:", header_text)
            assert "Магазин 1" in header_text

            # Test quantity stepper (+ button)
            plus_buttons = page.locator('button[aria-label="Збільшити кількість"]').all()
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

            # Verify inputs are now disabled
            first_input = page.locator('input[inputmode="numeric"]').first
            assert first_input.is_disabled(), "Quantity input should be disabled after submission"
            print("Verified report is read-only after submission.")

            # Logout
            logout_btn = page.locator('button[aria-label="Вийти"]')
            logout_btn.click()
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
            admin_page.fill('#login-password', "admin123")
            admin_page.click('button[type="submit"]')

            admin_page.wait_for_url("**/admin/**", timeout=5000)
            print("Admin landed on:", admin_page.url)
            admin_page.wait_for_selector('text=Зведена таблиця', timeout=5000)
            print("Admin summary view loaded")

            # Download XLSX test
            xlsx_link = admin_page.locator('a[href*="/admin/summary.xlsx"]')
            print("Found XLSX export link:", xlsx_link.get_attribute("href"))

            # Navigate to Reports
            admin_page.click('a:has-text("Звіти")')
            admin_page.wait_for_url("**/admin/reports**", timeout=5000)
            admin_page.wait_for_selector('text=Магазин 1', timeout=5000)
            print("Navigated to Reports list, store 1 card visible")

            # Check store1 report card and click into detail
            report_card = admin_page.locator('a:has-text("Магазин 1")').first
            report_card.click()
            admin_page.wait_for_url("**/admin/reports/**", timeout=5000)
            admin_page.wait_for_selector('text=Магазин 1', timeout=5000)
            print("Navigated to Report Detail:", admin_page.url)

            # Unlock report
            unlock_btn = admin_page.locator('button:has-text("Розблокувати")')
            if unlock_btn.count() > 0:
                print("Clicking unlock report...")
                unlock_btn.click()
                confirm_unlock = admin_page.locator('[role="dialog"] button:has-text("Розблокувати")')
                confirm_unlock.click()
                admin_page.wait_for_selector('text=Звіт розблоковано', timeout=5000)
                print("Report unlocked successfully!")

            # Navigate to Settings
            admin_page.click('a:has-text("Налаштування")')
            admin_page.wait_for_url("**/admin/settings**", timeout=5000)
            admin_page.wait_for_selector('button:has-text("Створити товар")', timeout=5000)
            print("Navigated to Settings")

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

            # Navigate to Logs
            admin_page.click('a:has-text("Журнал")')
            admin_page.wait_for_url("**/admin/logs**", timeout=5000)
            admin_page.wait_for_selector('text=Журнал аудиту', timeout=5000)
            admin_page.wait_for_selector('text=Тестовий Чай', timeout=5000)
            print("Navigated to Logs. Total logs rows:", admin_page.locator("tr, .rounded-card").count())
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
