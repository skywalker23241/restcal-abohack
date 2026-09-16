/* RestCal 界面引导：用连续移动的聚光框串联关键任务，避免打断式教学。 */
(function () {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

    function visibleElement(selectorOrResolver) {
        const result = typeof selectorOrResolver === "function"
            ? selectorOrResolver()
            : document.querySelector(selectorOrResolver);
        if (!(result instanceof HTMLElement)) return null;
        const rect = result.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 ? result : null;
    }

    function wait(ms) {
        return new Promise(resolve => window.setTimeout(resolve, ms));
    }

    function nextFrame() {
        return new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve)));
    }

    class ProductTour {
        constructor({steps, onFinish, onSkip} = {}) {
            this.steps = Array.isArray(steps) ? steps : [];
            this.onFinish = onFinish;
            this.onSkip = onSkip;
            this.index = -1;
            this.target = null;
            this.active = false;
            this.runToken = 0;
            this.targetClickHandler = null;
            this.returnFocus = null;
            this.positionFrame = 0;
            this.handleViewportChange = () => this.queuePosition();
            this.handleKeydown = event => this.onKeydown(event);
            this.build();
        }

        build() {
            const root = document.createElement("div");
            root.className = "product-tour";
            root.hidden = true;
            root.innerHTML = `
                <div class="product-tour-shade" data-tour-shade="top"></div>
                <div class="product-tour-shade" data-tour-shade="right"></div>
                <div class="product-tour-shade" data-tour-shade="bottom"></div>
                <div class="product-tour-shade" data-tour-shade="left"></div>
                <div class="product-tour-focus" aria-hidden="true"><span></span></div>
                <section class="product-tour-card" role="dialog" aria-modal="false" aria-labelledby="productTourTitle" aria-describedby="productTourText">
                    <div class="product-tour-pointer" aria-hidden="true"></div>
                    <div class="product-tour-meta">
                        <span class="product-tour-section"><i class="ph ph-calendar-blank" aria-hidden="true"></i><span id="productTourSection"></span></span>
                        <button class="product-tour-close" type="button" aria-label="退出界面引导"><i class="ph ph-x" aria-hidden="true"></i></button>
                    </div>
                    <h2 id="productTourTitle"></h2>
                    <p id="productTourText"></p>
                    <div class="product-tour-click-hint" hidden><i class="ph ph-cursor-click" aria-hidden="true"></i> 点击高亮区域继续</div>
                    <div class="product-tour-footer">
                        <div class="product-tour-progress" aria-hidden="true"><span></span></div>
                        <span class="product-tour-count" id="productTourStep"></span>
                        <div class="product-tour-actions">
                            <button class="btn ghost product-tour-back" type="button">上一步</button>
                            <button class="btn primary product-tour-next" type="button">下一步</button>
                        </div>
                    </div>
                </section>
            `;
            document.body.appendChild(root);
            this.root = root;
            this.card = root.querySelector(".product-tour-card");
            this.focus = root.querySelector(".product-tour-focus");
            this.title = root.querySelector("#productTourTitle");
            this.text = root.querySelector("#productTourText");
            this.section = root.querySelector("#productTourSection");
            this.sectionIcon = root.querySelector(".product-tour-section i");
            this.stepLabel = root.querySelector("#productTourStep");
            this.progress = root.querySelector(".product-tour-progress span");
            this.hint = root.querySelector(".product-tour-click-hint");
            this.backButton = root.querySelector(".product-tour-back");
            this.nextButton = root.querySelector(".product-tour-next");
            this.shades = Object.fromEntries(
                [...root.querySelectorAll("[data-tour-shade]")].map(node => [node.dataset.tourShade, node])
            );
            root.querySelector(".product-tour-close").addEventListener("click", () => this.skip());
            this.backButton.addEventListener("click", () => this.show(this.index - 1));
            this.nextButton.addEventListener("click", () => this.next());
        }

        async start(startIndex = 0) {
            if (!this.steps.length || this.active) return;
            this.returnFocus = document.activeElement;
            this.active = true;
            this.root.hidden = false;
            this.root.classList.add("is-starting");
            window.addEventListener("resize", this.handleViewportChange);
            window.addEventListener("scroll", this.handleViewportChange, true);
            document.addEventListener("keydown", this.handleKeydown);
            await nextFrame();
            this.root.classList.remove("is-starting");
            await this.show(startIndex);
        }

        async show(index) {
            if (!this.active) return;
            if (index < 0) index = 0;
            if (index >= this.steps.length) return this.finish();
            const token = ++this.runToken;
            const step = this.steps[index];
            this.root.classList.add("is-switching");
            this.card.setAttribute("aria-busy", "true");
            await wait(reduceMotion.matches ? 0 : 90);
            this.detachTarget();
            if (typeof step.beforeEnter === "function") await step.beforeEnter();
            if (!this.active || token !== this.runToken) return;

            let target = null;
            for (let attempt = 0; attempt < 24 && !target; attempt += 1) {
                target = visibleElement(step.target);
                if (!target) await wait(40);
            }
            if (!target) {
                console.warn(`界面引导未找到第 ${index + 1} 步目标`, step.target);
                return this.show(index + 1);
            }

            const initialRect = target.getBoundingClientRect();
            if (initialRect.top < 18 || initialRect.bottom > window.innerHeight - 18) {
                target.scrollIntoView({block: "center", inline: "center", behavior: reduceMotion.matches ? "auto" : "smooth"});
                await wait(reduceMotion.matches ? 20 : 360);
            }
            if (!this.active || token !== this.runToken) return;

            this.index = index;
            this.target = target;
            this.title.textContent = step.title;
            this.text.textContent = step.text;
            this.section.textContent = step.section || "快速上手";
            this.sectionIcon.className = `ph ${step.icon || "ph-compass"}`;
            this.stepLabel.textContent = `${index + 1} / ${this.steps.length}`;
            this.progress.style.width = `${((index + 1) / this.steps.length) * 100}%`;
            this.backButton.hidden = index === 0;
            const clickToAdvance = step.advanceOn === "target-click";
            this.hint.hidden = !clickToAdvance;
            this.nextButton.hidden = clickToAdvance;
            this.nextButton.textContent = index === this.steps.length - 1 ? "完成" : "下一步";
            target.classList.add("product-tour-target");
            target.setAttribute("data-product-tour-active", "true");
            if (clickToAdvance) {
                this.targetClickHandler = () => window.setTimeout(() => this.next(), 40);
                target.addEventListener("click", this.targetClickHandler, {once: true});
            }
            this.position();
            this.card.removeAttribute("aria-busy");
            await nextFrame();
            this.root.classList.remove("is-switching");
            window.setTimeout(() => this.queuePosition(), reduceMotion.matches ? 0 : 420);
            if (clickToAdvance) target.focus({preventScroll: true});
            else this.nextButton.focus({preventScroll: true});
        }

        next() {
            const step = this.steps[this.index];
            if (typeof step?.afterLeave === "function") step.afterLeave();
            this.show(this.index + 1);
        }

        onKeydown(event) {
            if (!this.active) return;
            if (event.key === "Escape") {
                event.preventDefault();
                this.skip();
            } else if (event.key === "ArrowLeft" && this.index > 0) {
                event.preventDefault();
                this.show(this.index - 1);
            } else if (event.key === "ArrowRight" && !this.nextButton.hidden) {
                event.preventDefault();
                this.next();
            }
        }

        queuePosition() {
            window.cancelAnimationFrame(this.positionFrame);
            this.positionFrame = window.requestAnimationFrame(() => this.position());
        }

        position() {
            if (!this.active || !this.target?.isConnected) return;
            const padding = window.innerWidth < 560 ? 6 : 9;
            const margin = window.innerWidth < 560 ? 10 : 16;
            const gap = window.innerWidth < 560 ? 12 : 16;
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const targetRect = this.target.getBoundingClientRect();
            const hole = {
                top: Math.max(0, targetRect.top - padding),
                right: Math.min(viewportWidth, targetRect.right + padding),
                bottom: Math.min(viewportHeight, targetRect.bottom + padding),
                left: Math.max(0, targetRect.left - padding)
            };
            const holeWidth = Math.max(0, hole.right - hole.left);
            const holeHeight = Math.max(0, hole.bottom - hole.top);

            Object.assign(this.shades.top.style, {left: "0px", top: "0px", width: "100vw", height: `${hole.top}px`});
            Object.assign(this.shades.bottom.style, {left: "0px", top: `${hole.bottom}px`, width: "100vw", height: `${Math.max(0, viewportHeight - hole.bottom)}px`});
            Object.assign(this.shades.left.style, {left: "0px", top: `${hole.top}px`, width: `${hole.left}px`, height: `${holeHeight}px`});
            Object.assign(this.shades.right.style, {left: `${hole.right}px`, top: `${hole.top}px`, width: `${Math.max(0, viewportWidth - hole.right)}px`, height: `${holeHeight}px`});
            Object.assign(this.focus.style, {
                left: `${hole.left}px`, top: `${hole.top}px`, width: `${holeWidth}px`, height: `${holeHeight}px`
            });

            this.card.style.maxWidth = `${Math.max(280, viewportWidth - margin * 2)}px`;
            const cardRect = this.card.getBoundingClientRect();
            const cardWidth = Math.min(cardRect.width, viewportWidth - margin * 2);
            const cardHeight = cardRect.height;
            const spaceBelow = viewportHeight - hole.bottom;
            const spaceAbove = hole.top;
            let placement = "bottom";
            let top;
            const left = Math.min(
                Math.max(margin, hole.left + holeWidth / 2 - cardWidth / 2),
                viewportWidth - cardWidth - margin
            );

            if (spaceBelow >= cardHeight + gap + margin) top = hole.bottom + gap;
            else if (spaceAbove >= cardHeight + gap + margin) {
                placement = "top";
                top = hole.top - cardHeight - gap;
            } else {
                placement = hole.top > viewportHeight / 2 ? "top" : "bottom";
                top = placement === "top" ? margin : viewportHeight - cardHeight - margin;
            }
            top = Math.min(Math.max(margin, top), Math.max(margin, viewportHeight - cardHeight - margin));
            const pointerX = Math.min(cardWidth - 28, Math.max(28, hole.left + holeWidth / 2 - left));
            this.card.dataset.placement = placement;
            this.card.style.setProperty("--tour-pointer-x", `${pointerX}px`);
            this.card.style.left = `${left}px`;
            this.card.style.top = `${top}px`;
        }

        detachTarget() {
            if (!this.target) return;
            if (this.targetClickHandler) this.target.removeEventListener("click", this.targetClickHandler);
            this.target.classList.remove("product-tour-target");
            this.target.removeAttribute("data-product-tour-active");
            this.target = null;
            this.targetClickHandler = null;
        }

        close() {
            if (!this.active) return;
            this.active = false;
            this.runToken += 1;
            this.detachTarget();
            this.root.hidden = true;
            this.root.classList.remove("is-switching", "is-starting");
            window.cancelAnimationFrame(this.positionFrame);
            window.removeEventListener("resize", this.handleViewportChange);
            window.removeEventListener("scroll", this.handleViewportChange, true);
            document.removeEventListener("keydown", this.handleKeydown);
            if (this.returnFocus instanceof HTMLElement && this.returnFocus.isConnected) {
                this.returnFocus.focus({preventScroll: true});
            }
            this.returnFocus = null;
        }

        finish() {
            this.close();
            if (typeof this.onFinish === "function") this.onFinish();
        }

        skip() {
            this.close();
            if (typeof this.onSkip === "function") this.onSkip();
        }
    }

    window.RestCalProductTour = Object.freeze({ProductTour});
})();
