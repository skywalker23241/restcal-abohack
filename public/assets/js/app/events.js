/* 休历 · RestCal —— 全局事件绑定
 *
 * 本文件是 public/app.html 主脚本按关注点拆出的一部分。这些文件都是传统
 * <script>（不是 ES module），顶层的 function / const / let 共享同一个全局词法
 * 作用域，所以彼此可以直接引用，不需要 import/export——这也是项目「零构建」
 * 约束下的取法。加载顺序见 app.html；真正会「立即执行」的语句全部集中在
 * app/bootstrap.js，本文件只声明，不执行。
 */

function bindEvents() {
    els.yearSelect.addEventListener("change", () => {
        currentYear = Number(els.yearSelect.value);
        clampAnchorToMonth();
        render();
    });

    els.monthSelect.addEventListener("change", () => {
        currentMonth = Number(els.monthSelect.value);
        clampAnchorToMonth();
        render();
    });

    els.prevMonth.addEventListener("click", () => shiftMonth(-1));
    els.nextMonth.addEventListener("click", () => shiftMonth(1));
    els.todayBtn.addEventListener("click", () => jumpToToday());
    els.brandHome.addEventListener("click", returnToTodayDayView);
    els.recentRecordsToggle.addEventListener("click", openRecentRecords);
    els.closeRecentRecords.addEventListener("click", closeRecentRecords);
    els.recentRecordsPanel.addEventListener("click", event => {
        if (event.target === els.recentRecordsPanel) closeRecentRecords();
    });
    els.overviewCustomize.addEventListener("click", openOverviewCustomizer);
    els.closeOverviewCustomize.addEventListener("click", closeOverviewCustomizer);
    els.overviewCustomizeDone.addEventListener("click", closeOverviewCustomizer);
    els.overviewCustomizeReset.addEventListener("click", () => updateOverviewModules([...DEFAULT_OVERVIEW_MODULES], "已恢复默认布局"));
    els.overviewCustomizerList.addEventListener("click", handleOverviewCustomizerClick);
    els.overviewCustomizerPreview.addEventListener("click", event => {
        if (!event.target.closest("[data-overview-add-modules]")) return;
        els.overviewCustomizerList.querySelector("[data-overview-add]:not(:disabled)")?.focus({preventScroll: true});
    });
    els.overviewCustomizeModal.addEventListener("click", event => {
        if (event.target === els.overviewCustomizeModal) closeOverviewCustomizer();
    });
    els.monthSummary.addEventListener("click", event => {
        if (event.target instanceof Element && event.target.closest("[data-overview-add-modules]")) {
            openOverviewCustomizer();
            return;
        }
        const button = event.target instanceof Element ? event.target.closest("[data-overview-action]") : null;
        if (button) handleOverviewAction(button.dataset.overviewAction, button);
    });

    [
        els.salaryInput,
        els.deductionInput,
        els.estimatedTaxInput,
        els.specialDeductionInput,
        els.taxCalculationMode,
        els.paydayInput,
        els.personalRateInput,
        els.sickRateInput,
        els.annualRateInput,
        els.compRateInput,
        els.annualQuotaInput,
        els.compQuotaInput,
        els.annualExpireRule,
        els.compExpireRule,
        els.applicantName,
        els.leaveRecipientInput,
        els.personalReasonInput,
        els.sickReasonInput,
        els.leaveHandoffInput,
        els.profileNameInput,
        els.companyInput,
        els.hireDateInput,
        els.workdaysInput,
        els.dailyHoursInput,
        els.scheduleTypeInput,
        els.ticketOrigin,
        els.ticketDestination,
        document.getElementById("flightOrigin"),
        document.getElementById("flightDestination")
    ].filter(Boolean).forEach(input => {
        input.addEventListener("input", () => {
            syncSettingsFromInputs();
            saveState();
            window.clearTimeout(settingsRenderTimer);
            settingsRenderTimer = window.setTimeout(() => {
                renderStats();
                renderSalary();
                renderHomeExtras();
            }, 150);
        });
    });
    els.restDaysPicker.addEventListener("change", () => { syncSettingsFromInputs(); saveState(); renderStats(); renderSalary(); renderHomeExtras(); });
    [els.ticketOrigin, els.ticketDestination].forEach(input => {
        input.addEventListener("change", () => {
            const invalid = input.value.trim() && !Object.hasOwn(window.RESTCAL_RAILWAY_STATIONS, input.value.trim());
            document.getElementById(`${input.id}Error`).textContent = invalid ? (getLanguage() === "en" ? "Choose a station from the list" : "请选择列表中的车站名称") : "";
        });
    });

    els.settingsToggle.addEventListener("click", () => openSettings());
    els.searchToggle.addEventListener("click", () => openSearch());
    document.addEventListener("click", event => {
        const button = event.target instanceof Element ? event.target.closest("[data-open-search-panel]") : null;
        if (button) openSearch();
    });
    document.addEventListener("click", event => {
        const button = event.target instanceof Element ? event.target.closest("[data-open-ticket-reminders]") : null;
        if (button) toggleTicketTool(button);
    });
    els.themeToggle.addEventListener("click", cycleTheme);
    els.languageToggle.addEventListener("click", () => window.RestCalI18n?.toggle());
    darkSchemeQuery.addEventListener("change", () => applyTheme(getThemePreference(), true));
    initAppearanceControls();
    els.closeSettings.addEventListener("click", closeSettings);
    els.settingsDone.addEventListener("click", () => {
        syncSettingsFromInputs();
        if (!saveState()) return;
        closeSettings();
        renderHomeExtras();
        renderTicketReminders();
        showToast("设置已保存");
    });
    els.settingsModal.addEventListener("click", event => {
        if (event.target === els.settingsModal) closeSettings();
    });
    document.querySelectorAll("[data-settings-nav]").forEach(button => {
        button.addEventListener("click", () => {
            setSettingsPanel(button.dataset.settingsNav);
            els.settingsPage?.classList.add("subpage-open");
        });
    });
    els.settingsBack.addEventListener("click", () => {
        els.settingsPage?.classList.remove("subpage-open");
        document.querySelector(`[data-settings-nav="${activeSettingsPanel}"]`)?.focus({preventScroll: true});
    });
    document.querySelectorAll("[data-open-settings]").forEach(button => {
        button.addEventListener("click", () => openSettings(button.dataset.openSettings));
    });
    els.rerunOnboarding.addEventListener("click", () => { closeSettings(); openOnboarding(true); });
    els.exportPersonalSettings.addEventListener("click", exportPersonalSettings);
    els.clearPersonalSettings.addEventListener("click", clearPersonalSettings);
    els.clearAllData.addEventListener("click", clearAllData);
    els.setupBannerStart.addEventListener("click", () => openOnboarding(true));
    els.setupBannerDismiss.addEventListener("click", () => {
        state.setupBannerDismissed = true;
        saveState();
        renderSetupBanner();
    });
    els.onboardingBack.addEventListener("click", () => { if (onboardingStep > 0) { onboardingStep -= 1; renderOnboardingStep(); } });
    els.onboardingSkip.addEventListener("click", skipOnboarding);
    els.onboardingNext.addEventListener("click", nextOnboardingStep);
    els.onboardingContent.addEventListener("input", syncOnboardingDraft);
    els.onboardingContent.addEventListener("change", syncOnboardingDraft);
    els.onboardingContent.addEventListener("keydown", event => { if (event.key === "Enter" && event.target.tagName !== "TEXTAREA") { event.preventDefault(); nextOnboardingStep(); } });
    document.querySelectorAll("[data-open-receipt]").forEach(button => {
        button.addEventListener("click", () => openReceiptModal(button.dataset.openReceipt));
    });
    document.querySelectorAll("[data-generate-leave-receipt]").forEach(button => {
        button.addEventListener("click", () => openLeaveGenerator());
    });
    els.ticketToolToggle.addEventListener("click", () => toggleTicketTool(els.ticketToolToggle));
    document.getElementById("closeTicketTool").addEventListener("click", () => closeBackdrop(els.ticketToolPanel));
    document.getElementById("openTicketSettings").addEventListener("click", () => {
        closeBackdrop(els.ticketToolPanel);
        openSettings("tickets");
    });
    els.ticketToolPanel.addEventListener("click", event => {
        if (event.target === els.ticketToolPanel) closeBackdrop(els.ticketToolPanel);
    });
    els.habitToolToggle.addEventListener("click", () => openHabitTool(els.habitToolToggle));
    document.getElementById("closeHabitTool").addEventListener("click", () => closeBackdrop(els.habitToolPanel));
    els.habitToolPanel.addEventListener("click", event => {
        if (event.target === els.habitToolPanel) closeBackdrop(els.habitToolPanel);
    });
    els.habitCreateForm.addEventListener("submit", createHabit);
    els.habitIconToggle.addEventListener("click", event => {
        event.stopPropagation();
        toggleHabitIconMenu();
    });
    els.habitIconMenu.addEventListener("click", event => {
        const button = event.target.closest("[data-habit-icon]");
        if (button) selectHabitIcon(button.dataset.habitIcon);
    });
    document.addEventListener("click", event => {
        if (!els.habitCreateControl.contains(event.target)) closeHabitIconMenu();
    });
    els.habitList.addEventListener("click", handleHabitListClick);
    els.ticketReminders.addEventListener("click", async event => {
        const button = event.target.closest("[data-ticket-export]");
        if (!button || !window.XiuliIcs) return;
        const exportKeys = new Set(button.dataset.ticketExport.split(","));
        const items = getTicketReminders(currentYear).filter(item => exportKeys.has(`${item.tripType}:${toISO(item.departure)}`));
        if (!items.length) return;
        const content = XiuliIcs.generateIcs({
            ticketReminders: items,
            ticketReminderTime: state.ticketPreferences.reminderTime,
            ticketAdvanceDays: state.ticketPreferences.advanceDays,
            eventUrlFor: ({date}) => restcalDateLink(date)
        });
        const filename = `RestCal-${toISO(items[0].holidayStart)}-${items[0].name}往返购票提醒.ics`;
        button.disabled = true;
        try {
            const nativeCalendar = window.Capacitor?.Plugins?.Calendar;
            if (nativeCalendar?.addEvent) {
                for (const item of items) await nativeCalendar.addEvent(ticketCalendarEvent(item));
                showToast(`已添加 ${items.length} 个购票提醒`);
                return;
            }
            if (window.xiuliCalendar?.addEvent) {
                const result = await window.xiuliCalendar.addEvent({content, filename});
                if (result?.error) throw new Error(result.error);
                showToast("已交给默认日历应用打开");
                return;
            }
            XiuliIcs.downloadIcs(content, filename);
            showToast("日历文件已下载，请在系统日历中打开");
        } catch (error) {
            showToast(`无法打开系统日历：${error.message || "未知错误"}`, "error", {duration: 6000});
        } finally {
            button.disabled = false;
        }
    });
    document.addEventListener("click", event => {
        const button = event.target instanceof Element ? event.target.closest("[data-open-settings-dynamic]") : null;
        if (button) openSettings(button.dataset.openSettingsDynamic);
    });
    els.icsToolBtn?.addEventListener("click", () => {
        openSettings("connections");
    });
    els.openIcsExport.addEventListener("click", () => {
        setSettingsPanel("data");
        window.setTimeout(() => document.getElementById("icsCard")?.scrollIntoView({behavior: "smooth", block: "center"}), 180);
    });
    els.exportIcsCurrentYear?.addEventListener("click", () => exportIcsFile(currentYear));
    els.exportIcsAll?.addEventListener("click", () => exportIcsFile(null));
    [els.taxCalculationMode, els.annualExpireRule, els.compExpireRule].filter(Boolean).forEach(sel => {
        sel.addEventListener("change", () => {
            syncSettingsFromInputs();
            saveState();
            renderStats();
            renderSalary();
            renderHomeExtras();
        });
    });

    els.guideToggle.addEventListener("click", openGuide);
    els.closeReceipt.addEventListener("click", closeReceiptModal);
    els.receiptDone.addEventListener("click", closeReceiptModal);
    els.downloadReceipt.addEventListener("click", downloadCurrentReceiptImage);
    els.salaryReceiptYear.addEventListener("change", () => {
        updateSalaryReceiptMonthOptions();
        updateSalaryReceiptPreview();
    });
    els.salaryReceiptMonth.addEventListener("change", updateSalaryReceiptPreview);
    els.salaryReceiptPrev.addEventListener("click", () => shiftSalaryReceiptMonth(-1));
    els.salaryReceiptNext.addEventListener("click", () => shiftSalaryReceiptMonth(1));
    els.receiptModal.addEventListener("click", event => {
        if (event.target === els.receiptModal) closeReceiptModal();
    });
    els.closeLeaveGenerator.addEventListener("click", closeLeaveGenerator);
    els.leaveGeneratorDone.addEventListener("click", closeLeaveGenerator);
    els.downloadLeaveReceipt.addEventListener("click", downloadLeaveReceiptImage);
    els.emailLeaveDoc.addEventListener("click", emailCurrentLeaveDoc);
    els.leaveGeneratorModal.addEventListener("click", event => {
        if (event.target === els.leaveGeneratorModal) closeLeaveGenerator();
    });
    els.closeGuide.addEventListener("click", dismissProductTourIntro);
    els.guideDone.addEventListener("click", startProductTour);
    els.guideModal.addEventListener("click", event => {
        if (event.target === els.guideModal) dismissProductTourIntro();
    });

    els.exportCsv.addEventListener("click", exportCsv);
    els.importCsv.addEventListener("change", importCsv);
    [els.webdavUrl, els.webdavUsername, els.webdavPassword].forEach(input => {
        input.addEventListener("input", () => {
            syncWebDavConfigFromInputs();
            renderWebdavCard();
        });
    });
    els.webdavTest.addEventListener("click", runWebdavTest);
    els.webdavUpload.addEventListener("click", runWebdavUpload);
    els.webdavDownload.addEventListener("click", runWebdavDownload);
    els.webdavConfigure.addEventListener("click", openWebdavConfigModal);
    els.closeWebdavConfig.addEventListener("click", closeWebdavConfigModal);
    els.webdavConfigDone.addEventListener("click", closeWebdavConfigModal);
    els.webdavConfigModal.addEventListener("click", event => {
        if (event.target === els.webdavConfigModal) closeWebdavConfigModal();
    });
    els.googleCalendarConnect.addEventListener("click", openGoogleConfig);
    els.googleCalendarSync.addEventListener("click", () => syncGoogleCalendar({announce: true}));
    els.googleCalendarDisconnect.addEventListener("click", disconnectGoogleCalendar);
    els.googleCalendarAutoSync.addEventListener("change", saveIntegrationPreferences);
    document.querySelectorAll("[data-google-category]").forEach(input => input.addEventListener("change", saveIntegrationPreferences));
    els.defaultRecipientEmail.addEventListener("input", saveIntegrationPreferences);
    els.closeGoogleConfig.addEventListener("click", closeGoogleConfig);
    els.googleConfigCancel.addEventListener("click", closeGoogleConfig);
    els.googleConfigContinue.addEventListener("click", connectGoogleCalendar);
    els.googleConfigModal.addEventListener("click", event => {
        if (event.target === els.googleConfigModal) closeGoogleConfig();
    });
    els.generateDoc.addEventListener("click", generateLeaveDoc);
    [els.leaveTypeForDoc, els.leaveStart, els.leaveEnd, els.leaveReasonDoc, els.leaveApplicantDoc, els.leaveRecipientDoc, els.leaveHandoffDoc].forEach(input => {
        input.addEventListener("input", clearLeaveReceiptPreview);
        input.addEventListener("change", clearLeaveReceiptPreview);
    });
    els.statsPeriodMode.addEventListener("click", event => {
        const button = event.target.closest("[data-stats-period]");
        if (!button) return;
        setStatsPeriodMode(button.dataset.statsPeriod);
    });
    els.yearStatsMode.addEventListener("click", event => {
        const button = event.target.closest("[data-year-mode]");
        if (!button) return;
        yearStatsMode = button.dataset.yearMode;
        els.yearStatsMode.querySelectorAll(".seg-btn").forEach(item => {
            const active = item.dataset.yearMode === yearStatsMode;
            item.classList.toggle("active", active);
            item.setAttribute("aria-pressed", String(active));
        });
        renderStats();
    });
    els.recentRecords.addEventListener("click", event => {
        const button = event.target instanceof Element ? event.target.closest("[data-record-date]") : null;
        if (button?.dataset.recordDate) {
            closeRecentRecords();
            jumpToSearchDate(button.dataset.recordDate);
        }
    });

    els.closeSearch.addEventListener("click", closeSearch);
    els.searchModal.addEventListener("click", event => {
        if (event.target === els.searchModal) closeSearch();
    });
    els.searchClear.addEventListener("click", clearSearchFilters);
    els.searchApply.addEventListener("click", runSearch);
    [els.searchInput, els.searchStatus, els.searchFrom, els.searchTo].forEach(input => {
        input.addEventListener("input", queueSearch);
        input.addEventListener("change", runSearch);
    });
    els.searchResults.addEventListener("click", event => {
        const button = event.target instanceof Element ? event.target.closest("[data-search-date]") : null;
        if (button?.dataset.searchDate) jumpToSearchDate(button.dataset.searchDate);
    });

    els.closeModal.addEventListener("click", closeModal);
    els.modalCancel.addEventListener("click", closeModal);
    els.calendarGrid.addEventListener("pointerover", event => {
        const card = event.target instanceof Element ? event.target.closest(".day-card.has-note[data-note]") : null;
        if (!card || card.contains(event.relatedTarget)) return;
        showNoteTooltip(card);
    });
    els.calendarGrid.addEventListener("pointerout", event => {
        const card = event.target instanceof Element ? event.target.closest(".day-card.has-note[data-note]") : null;
        if (!card || card.contains(event.relatedTarget)) return;
        hideNoteTooltip(card);
    });
    els.calendarGrid.addEventListener("focusin", event => {
        const card = event.target instanceof Element ? event.target.closest(".day-card.has-note[data-note]") : null;
        if (card) showNoteTooltip(card);
    });
    els.calendarGrid.addEventListener("focusout", event => {
        const card = event.target instanceof Element ? event.target.closest(".day-card.has-note[data-note]") : null;
        if (card) hideNoteTooltip(card);
    });
    els.calendarGrid.addEventListener("click", event => {
        const card = event.target instanceof Element ? event.target.closest(".day-card.clickable, .week-row, .day-page") : null;
        if (card?.dataset.date) {
            hideNoteTooltip();
            openModal(card.dataset.date);
        }
    });
    window.addEventListener("resize", () => hideNoteTooltip());
    window.addEventListener("scroll", () => hideNoteTooltip(), true);
    document.addEventListener("keydown", event => {
        if (event.key !== "Escape") return;
        const openAirlinePicker = document.querySelector(".airline-picker[open]");
        if (openAirlinePicker) {
            openAirlinePicker.open = false;
            return;
        }
        if (!els.habitIconMenu.hidden) return closeHabitIconMenu(true);
        if (productTour?.active) return skipProductTour();
        if (els.confirmModal.classList.contains("open")) return resolveConfirm(false);
        if (document.getElementById("stationPickerModal").classList.contains("open")) return closeStationPicker();
        if (els.habitToolPanel.classList.contains("open")) return closeBackdrop(els.habitToolPanel);
        if (els.ticketToolPanel.classList.contains("open")) return closeBackdrop(els.ticketToolPanel);
        if (els.overviewCustomizeModal.classList.contains("open")) return closeOverviewCustomizer();
        if (els.recentRecordsPanel.classList.contains("open")) return closeRecentRecords();
        if (els.searchModal.classList.contains("open")) return closeSearch();
        if (els.googleConfigModal.classList.contains("open")) return closeGoogleConfig();
        if (els.webdavConfigModal.classList.contains("open")) return closeWebdavConfigModal();
        if (els.dayModal.classList.contains("open")) return closeModal();
        if (els.receiptModal.classList.contains("open")) return closeReceiptModal();
        if (els.leaveGeneratorModal.classList.contains("open")) return closeLeaveGenerator();
        if (els.settingsModal.classList.contains("open")) return closeSettings();
        if (els.guideModal.classList.contains("open")) return dismissProductTourIntro();
    });
    document.addEventListener("keydown", event => {
        // 轻量焦点圈定：Tab 只在最上层弹窗内循环（Set 保留插入顺序，最后打开的在最上层）
        if (event.key !== "Tab" || !openBackdrops.size) return;
        const topmost = [...openBackdrops].at(-1);
        if (topmost.classList.contains("closing")) return;
        const focusables = [...topmost.querySelectorAll(
            'button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex]:not([tabindex="-1"])'
        )].filter(node => node.offsetParent !== null);
        if (!focusables.length) return event.preventDefault();
        const first = focusables[0];
        const last = focusables.at(-1);
        if (event.shiftKey && (document.activeElement === first || !topmost.contains(document.activeElement))) {
            event.preventDefault();
            last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !topmost.contains(document.activeElement))) {
            event.preventDefault();
            first.focus();
        }
    });
    els.dayModal.addEventListener("pointerdown", event => {
        dayModalBackdropPress = event.target === els.dayModal;
    });
    els.dayModal.addEventListener("pointercancel", () => {
        dayModalBackdropPress = false;
    });
    els.dayModal.addEventListener("click", event => {
        const shouldClose = dayModalBackdropPress && event.target === els.dayModal;
        dayModalBackdropPress = false;
        if (shouldClose) closeModal();
    });
    document.querySelectorAll("[data-action]").forEach(button => {
        button.addEventListener("click", () => chooseStatus(button.dataset.action));
    });
    els.modalGenerateDoc.addEventListener("click", generateLeaveDocFromModal);
    els.modalHabitList.addEventListener("click", event => {
        const button = event.target.closest("[data-modal-habit-id]");
        if (button) togglePendingHabit(button.dataset.modalHabitId);
    });
    els.modalClear.addEventListener("click", clearActiveRecord);
    els.modalAddCalendar.addEventListener("click", addActiveDateToCalendar);
    els.modalSave.addEventListener("click", saveModalRecord);
    els.confirmCancel.addEventListener("click", () => resolveConfirm(false));
    els.confirmOk.addEventListener("click", () => resolveConfirm(true));
    els.confirmModal.addEventListener("click", event => {
        if (event.target === els.confirmModal) resolveConfirm(false);
    });
}
