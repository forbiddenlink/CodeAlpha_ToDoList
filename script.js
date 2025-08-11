class TodoApp {
    constructor() {
        this.todos = JSON.parse(localStorage.getItem('todos')) || [];
        this.currentFilter = 'all';
        this.searchQuery = '';
        this.isDarkMode = this.getInitialDarkMode();
        this.selectedTaskIndex = -1;
        this.isLoading = false;
        this.lastDeleted = null; // For undo
        this.lastCleared = null; // For undo
        this.init();
    }

    init() {
        this.setupEventListeners();
        this.applyDarkMode();
        this.renderTodos();
        this.updateStats();
        this.setupServiceWorker();
    }

    getInitialDarkMode() {
        // Check localStorage first
        const savedMode = localStorage.getItem('darkMode');
        if (savedMode !== null) {
            return savedMode === 'true';
        }
        
        // Check system preference
        if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
            return true;
        }
        
        return false;
    }

    setupEventListeners() {
        // Form submission for adding new todos
        const todoForm = document.getElementById('todo-form');
        todoForm.addEventListener('submit', (e) => {
            e.preventDefault();
            this.addTodo();
        });

        // Filter buttons with improved accessibility
        const filterButtons = document.querySelectorAll('.filter-btn');
        filterButtons.forEach(btn => {
            btn.addEventListener('click', (e) => {
                this.setFilter(e.target.dataset.filter);
            });
        });

        // Clear completed button
        const clearCompletedBtn = document.getElementById('clear-completed');
        clearCompletedBtn.addEventListener('click', () => {
            this.clearCompleted();
        });

        // Search functionality with debouncing
        const searchInput = document.getElementById('search-input');
        let searchTimeout;
        searchInput.addEventListener('input', (e) => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                this.searchQuery = e.target.value.toLowerCase();
                this.renderTodos();
            }, 300);
        });

        // Dark mode toggle with enhanced UX
        const darkModeBtn = document.getElementById('dark-mode-toggle');
        darkModeBtn.addEventListener('click', () => {
            this.toggleDarkMode();
        });

        // Listen for system theme changes
        if (window.matchMedia) {
            const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
            mediaQuery.addEventListener('change', (e) => {
                // Only auto-switch if user hasn't manually set a preference
                if (localStorage.getItem('darkMode') === null) {
                    this.isDarkMode = e.matches;
                    this.applyDarkMode();
                    this.showToast(
                        `Switched to ${this.isDarkMode ? 'dark' : 'light'} mode based on system preference`, 
                        'info'
                    );
                }
            });
        }

        // Export functionality
        const exportBtn = document.getElementById('export-btn');
        exportBtn.addEventListener('click', () => {
            this.exportTodos();
        });

        // Import functionality
        const importBtn = document.getElementById('import-btn');
        const importFile = document.getElementById('import-file');
        
        importBtn.addEventListener('click', () => {
            importFile.click();
        });
        
        importFile.addEventListener('change', (e) => {
            this.importTodos(e.target.files[0]);
        });

        // Enhanced keyboard shortcuts
        document.addEventListener('keydown', (e) => {
            this.handleKeyboardShortcuts(e);
        });

        // Touch/swipe gestures for mobile
        this.setupTouchGestures();

        // Focus management
        this.setupFocusManagement();
    }

    setupTouchGestures() {
        const todoList = document.getElementById('todo-list');
        
        // Swipe to delete functionality
        let startX = 0;
        let currentX = 0;
        let isDragging = false;

        todoList.addEventListener('touchstart', (e) => {
            const touch = e.touches[0];
            startX = touch.clientX;
            currentX = startX;
            isDragging = false;
        });

        todoList.addEventListener('touchmove', (e) => {
            if (!startX) return;
            
            const touch = e.touches[0];
            currentX = touch.clientX;
            const diffX = currentX - startX;
            
            if (Math.abs(diffX) > 10) {
                isDragging = true;
                e.preventDefault();
            }
        });

        todoList.addEventListener('touchend', (e) => {
            if (!isDragging) return;
            
            const diffX = currentX - startX;
            const target = e.target.closest('.todo-item');
            
            if (target && diffX < -50) {
                // Swipe left to delete
                const taskId = parseInt(target.dataset.id);
                this.deleteTodo(taskId);
            }
            
            startX = 0;
            currentX = 0;
            isDragging = false;
        });
    }

    setupFocusManagement() {
        // Auto-focus search on Ctrl/Cmd + F
        document.addEventListener('keydown', (e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
                e.preventDefault();
                const searchInput = document.getElementById('search-input');
                searchInput.focus();
                searchInput.select();
            }
        });

        // Focus trap for modal-like elements
        const focusableElements = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
        
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Tab') {
                const activeElement = document.activeElement;
                const container = activeElement.closest('.todo-item.editing');
                
                if (container) {
                    const focusable = container.querySelectorAll(focusableElements);
                    const firstElement = focusable[0];
                    const lastElement = focusable[focusable.length - 1];
                    
                    if (e.shiftKey) {
                        if (activeElement === firstElement) {
                            e.preventDefault();
                            lastElement.focus();
                        }
                    } else {
                        if (activeElement === lastElement) {
                            e.preventDefault();
                            firstElement.focus();
                        }
                    }
                }
            }
        });
    }

    handleKeyboardShortcuts(e) {
        // Global shortcuts (Ctrl/Cmd + key)
        if (e.ctrlKey || e.metaKey) {
            switch(e.key) {
                case 's':
                    e.preventDefault();
                    this.exportTodos();
                    break;
                case 'o':
                    e.preventDefault();
                    document.getElementById('import-file').click();
                    break;
                case 'd':
                    e.preventDefault();
                    this.toggleDarkMode();
                    break;
                case 'f':
                    e.preventDefault();
                    const searchInput = document.getElementById('search-input');
                    searchInput.focus();
                    searchInput.select();
                    break;
                case 'n':
                    e.preventDefault();
                    document.getElementById('todo-input').focus();
                    break;
            }
        }
        
        // Single key shortcuts (when not typing)
        if (!e.target.matches('input, textarea, select')) {
            switch(e.key) {
                case 'Escape':
                    // Clear search and reset filters
                    const searchInput = document.getElementById('search-input');
                    if (searchInput.value) {
                        searchInput.value = '';
                        this.searchQuery = '';
                        this.renderTodos();
                        this.showToast('Search cleared', 'info');
                    }
                    break;
                case 'Delete':
                    // Delete selected task (if any)
                    const selectedTask = document.querySelector('.todo-item.selected');
                    if (selectedTask) {
                        const taskId = parseInt(selectedTask.dataset.id);
                        this.deleteTodo(taskId);
                    }
                    break;
                case 'Enter':
                    // Complete selected task
                    const selectedTaskToComplete = document.querySelector('.todo-item.selected');
                    if (selectedTaskToComplete) {
                        const taskId = parseInt(selectedTaskToComplete.dataset.id);
                        this.toggleTodo(taskId);
                    }
                    break;
            }
        }
        
        // Arrow key navigation with improved accessibility
        if (!e.target.matches('input, textarea, select')) {
            const currentSelected = document.querySelector('.todo-item.selected');
            const allTasks = document.querySelectorAll('.todo-item:not(.editing)');
            
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                
                if (!currentSelected && allTasks.length > 0) {
                    // Select first task
                    allTasks[0].classList.add('selected');
                    allTasks[0].focus();
                } else if (currentSelected) {
                    const currentIndex = Array.from(allTasks).indexOf(currentSelected);
                    let newIndex;
                    
                    if (e.key === 'ArrowDown') {
                        newIndex = Math.min(currentIndex + 1, allTasks.length - 1);
                    } else {
                        newIndex = Math.max(currentIndex - 1, 0);
                    }
                    
                    currentSelected.classList.remove('selected');
                    allTasks[newIndex].classList.add('selected');
                    allTasks[newIndex].focus();
                }
            }
        }
    }

    async addTodo() {
        const input = document.getElementById('todo-input');
        const prioritySelect = document.getElementById('priority-select');
        const categorySelect = document.getElementById('category-select');
        const dueDateInput = document.getElementById('due-date-input');
        const text = input.value.trim();
        const priority = prioritySelect.value;
        const category = categorySelect.value;
        const dueDate = dueDateInput.value;
        
        if (text) {
            const todo = {
                id: Date.now(),
                text: this.escapeHtml(text),
                completed: false,
                priority: priority,
                category: category,
                dueDate: dueDate,
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString()
            };
            
            this.todos.unshift(todo);
            this.saveTodos();
            this.renderTodos();
            this.updateStats();
            
            // Clear form
            input.value = '';
            dueDateInput.value = '';
            prioritySelect.value = 'normal';
            categorySelect.value = 'personal';
            
            // Show success notification
            this.showToast('Task added successfully!', 'success');
            
            // Focus back to input for quick adding
            input.focus();
        } else {
            this.showToast('Please enter a task description', 'warning');
            input.focus();
        }
    }

    toggleTodo(id) {
        const todo = this.todos.find(t => t.id === id);
        if (todo) {
            todo.completed = !todo.completed;
            todo.updatedAt = new Date().toISOString();
            this.saveTodos();
            this.renderTodos();
            this.updateStats();
            
            const action = todo.completed ? 'completed' : 'marked as active';
            this.showToast(`Task ${action}!`, 'success');
        }
    }

    deleteTodo(id) {
        const todo = this.todos.find(t => t.id === id);
        if (todo) {
            const index = this.todos.indexOf(todo);
            this.lastDeleted = { ...todo, index };
            this.todos.splice(index, 1);
            this.saveTodos();
            this.renderTodos();
            this.updateStats();
            this.showUndoToast('Task deleted', () => this.undoDelete());
        }
    }

    undoDelete() {
        if (this.lastDeleted) {
            this.todos.splice(this.lastDeleted.index, 0, this.lastDeleted);
            this.saveTodos();
            this.renderTodos();
            this.updateStats();
            this.showToast('Task restored', 'success');
            this.lastDeleted = null;
        }
    }

    editTodo(id) {
        const todoItem = document.querySelector(`[data-id="${id}"]`);
        if (!todoItem) return;

        const todo = this.todos.find(t => t.id === id);
        if (!todo) return;

        // Add editing class
        todoItem.classList.add('editing');

        // Create edit input
        const editInput = document.createElement('input');
        editInput.type = 'text';
        editInput.className = 'edit-input';
        editInput.value = todo.text;
        editInput.setAttribute('aria-label', 'Edit task description');

        // Create edit actions
        const editActions = document.createElement('div');
        editActions.className = 'edit-actions';

        const saveBtn = document.createElement('button');
        saveBtn.className = 'save-btn';
        saveBtn.innerHTML = '<i class="fas fa-check"></i>';
        saveBtn.setAttribute('aria-label', 'Save changes');

        const cancelBtn = document.createElement('button');
        cancelBtn.className = 'cancel-btn';
        cancelBtn.innerHTML = '<i class="fas fa-times"></i>';
        cancelBtn.setAttribute('aria-label', 'Cancel editing');

        editActions.appendChild(saveBtn);
        editActions.appendChild(cancelBtn);

        // Replace content with edit form
        const todoContent = todoItem.querySelector('.todo-content');
        const todoActions = todoItem.querySelector('.todo-actions');
        
        todoContent.style.display = 'none';
        todoActions.style.display = 'none';

        todoItem.appendChild(editInput);
        todoItem.appendChild(editActions);

        // Focus on input
        editInput.focus();
        editInput.select();

        // Save function
        const saveEdit = () => {
            const newText = editInput.value.trim();
            if (newText && newText !== todo.text) {
                todo.text = this.escapeHtml(newText);
                todo.updatedAt = new Date().toISOString();
                this.saveTodos();
                this.renderTodos();
                this.showToast('Task updated successfully!', 'success');
            }
            this.exitEditMode(todoItem, todoContent, todoActions, editInput, editActions);
        };

        // Cancel function
        const cancelEdit = () => {
            this.exitEditMode(todoItem, todoContent, todoActions, editInput, editActions);
        };

        // Event listeners
        saveBtn.addEventListener('click', saveEdit);
        cancelBtn.addEventListener('click', cancelEdit);
        editInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                saveEdit();
            } else if (e.key === 'Escape') {
                cancelEdit();
            }
        });

        // Auto-save on blur (optional)
        editInput.addEventListener('blur', () => {
            setTimeout(() => {
                if (todoItem.classList.contains('editing')) {
                    saveEdit();
                }
            }, 100);
        });
    }

    exitEditMode(todoItem, todoContent, todoActions, editInput, editActions) {
        todoItem.classList.remove('editing');
        todoContent.style.display = 'block';
        todoActions.style.display = 'flex';
        editInput.remove();
        editActions.remove();
    }

    setFilter(filter) {
        this.currentFilter = filter;
        
        // Update active filter button
        document.querySelectorAll('.filter-btn').forEach(btn => {
            btn.classList.remove('active');
            btn.setAttribute('aria-selected', 'false');
        });
        
        const activeBtn = document.querySelector(`[data-filter="${filter}"]`);
        if (activeBtn) {
            activeBtn.classList.add('active');
            activeBtn.setAttribute('aria-selected', 'true');
        }
        
        this.renderTodos();
        this.updateStats();
        
        // Announce filter change to screen readers
        const filterNames = { all: 'all tasks', active: 'active tasks', completed: 'completed tasks' };
        this.announceToScreenReader(`Showing ${filterNames[filter]}`);
    }

    clearCompleted() {
        const completedTodos = this.todos.filter(todo => todo.completed);
        const completedCount = completedTodos.length;
        if (completedCount === 0) {
            this.showToast('No completed tasks to clear', 'info');
            return;
        }
        this.lastCleared = completedTodos;
        this.todos = this.todos.filter(todo => !todo.completed);
        this.saveTodos();
        this.renderTodos();
        this.updateStats();
        this.showUndoToast(`Cleared ${completedCount} completed task${completedCount > 1 ? 's' : ''}!`, () => this.undoClearCompleted());
    }

    undoClearCompleted() {
        if (this.lastCleared && this.lastCleared.length > 0) {
            this.todos = this.todos.concat(this.lastCleared);
            // Sort by createdAt to restore order
            this.todos.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            this.saveTodos();
            this.renderTodos();
            this.updateStats();
            this.showToast('Completed tasks restored', 'success');
            this.lastCleared = null;
        }
    }

    getFilteredTodos() {
        let filtered = this.todos;
        
        // Apply search filter
        if (this.searchQuery) {
            filtered = filtered.filter(todo => 
                todo.text.toLowerCase().includes(this.searchQuery) ||
                todo.category.toLowerCase().includes(this.searchQuery) ||
                todo.priority.toLowerCase().includes(this.searchQuery)
            );
        }
        
        // Apply status filter
        switch (this.currentFilter) {
            case 'active':
                filtered = filtered.filter(todo => !todo.completed);
                break;
            case 'completed':
                filtered = filtered.filter(todo => todo.completed);
                break;
            default:
                // 'all' - no additional filtering
                break;
        }
        
        // Sort by priority, then by creation date
        filtered.sort((a, b) => {
            const priorityOrder = { urgent: 3, high: 2, normal: 1 };
            const aPriority = priorityOrder[a.priority] || 1;
            const bPriority = priorityOrder[b.priority] || 1;
            
            if (aPriority !== bPriority) {
                return bPriority - aPriority;
            }
            
            return new Date(b.createdAt) - new Date(a.createdAt);
        });
        
        return filtered;
    }

    renderTodos() {
        const todoList = document.getElementById('todo-list');
        const filteredTodos = this.getFilteredTodos();
        
        if (filteredTodos.length === 0) {
            const emptyMessage = this.searchQuery 
                ? `No tasks found matching "${this.searchQuery}"`
                : this.currentFilter === 'all' 
                    ? 'No tasks yet. Add your first task above!'
                    : `No ${this.currentFilter} tasks found`;
            
            todoList.innerHTML = `<li class="empty-state">${emptyMessage}</li>`;
            return;
        }
        
        // Render tasks without inline event handlers
        todoList.innerHTML = filteredTodos.map(todo => {
            const dueDateStatus = this.getDueDateStatus(todo.dueDate);
            const priorityClass = todo.priority !== 'normal' ? `priority-${todo.priority}` : '';
            const completedClass = todo.completed ? 'completed' : '';
            return `
                <li class="todo-item ${priorityClass} ${completedClass}" data-id="${todo.id}" tabindex="0" role="listitem">
                    <div class="todo-checkbox ${todo.completed ? 'checked' : ''}"
                         role="checkbox"
                         aria-checked="${todo.completed}"
                         aria-label="${todo.completed ? 'Mark as active' : 'Mark as completed'}">
                        ${todo.completed ? '<i class="fas fa-check"></i>' : ''}
                    </div>
                    <div class="todo-content">
                        <div class="todo-text">${todo.text}</div>
                        <div class="todo-meta">
                            <span class="priority-badge ${todo.priority}">${todo.priority}</span>
                            <span class="category-badge ${todo.category}">${todo.category}</span>
                            ${todo.dueDate ? `<span class="due-date ${dueDateStatus.class}">${this.formatDueDate(todo.dueDate)}</span>` : ''}
                        </div>
                    </div>
                    <div class="todo-actions">
                        <button class="action-btn edit-btn" aria-label="Edit task">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="action-btn delete-btn" aria-label="Delete task">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </li>
            `;
        }).join('');
        
        // Add event listeners for actions after rendering
        todoList.querySelectorAll('.todo-item').forEach(item => {
            const taskId = parseInt(item.dataset.id);
            // Toggle complete on checkbox click
            const checkbox = item.querySelector('.todo-checkbox');
            if (checkbox) {
                checkbox.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.toggleTodo(taskId);
                });
            }
            // Edit button
            const editBtn = item.querySelector('.edit-btn');
            if (editBtn) {
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.editTodo(taskId);
                });
            }
            // Delete button
            const deleteBtn = item.querySelector('.delete-btn');
            if (deleteBtn) {
                deleteBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.deleteTodo(taskId);
                });
            }
            // Keyboard navigation
            item.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    this.toggleTodo(taskId);
                }
            });
        });
    }

    updateStats() {
        const totalTasks = this.todos.length;
        const completedTasks = this.todos.filter(todo => todo.completed).length;
        const activeTasks = totalTasks - completedTasks;
        const progressPercentage = totalTasks > 0 ? (completedTasks / totalTasks) * 100 : 0;
        
        const tasksCountElement = document.getElementById('tasks-count');
        const progressFillElement = document.getElementById('progress-fill');
        const progressBarElement = document.querySelector('.progress-bar');
        
        // Update text
        if (this.currentFilter === 'all') {
            tasksCountElement.textContent = `${activeTasks} task${activeTasks !== 1 ? 's' : ''} remaining`;
        } else {
            const filteredTodos = this.getFilteredTodos();
            tasksCountElement.textContent = `${filteredTodos.length} task${filteredTodos.length !== 1 ? 's' : ''} found`;
        }
        
        // Update progress bar
        progressFillElement.style.width = `${progressPercentage}%`;
        progressBarElement.setAttribute('aria-valuenow', progressPercentage);
        
        // Update ARIA labels
        progressBarElement.setAttribute('aria-label', `Progress: ${completedTasks} of ${totalTasks} tasks completed`);
    }

    toggleDarkMode() {
        this.isDarkMode = !this.isDarkMode;
        localStorage.setItem('darkMode', this.isDarkMode.toString());
        this.applyDarkMode();
        
        const darkModeBtn = document.getElementById('dark-mode-toggle');
        darkModeBtn.setAttribute('aria-pressed', this.isDarkMode.toString());
        
        this.showToast(`Switched to ${this.isDarkMode ? 'dark' : 'light'} mode`, 'info');
    }

    applyDarkMode() {
        const body = document.body;
        const darkModeBtn = document.getElementById('dark-mode-toggle');
        const icon = darkModeBtn.querySelector('i');
        
        if (this.isDarkMode) {
            body.setAttribute('data-theme', 'dark');
            icon.className = 'fas fa-sun';
            darkModeBtn.setAttribute('aria-pressed', 'true');
        } else {
            body.removeAttribute('data-theme');
            icon.className = 'fas fa-moon';
            darkModeBtn.setAttribute('aria-pressed', 'false');
        }
    }

    exportTodos() {
        try {
            const data = {
                todos: this.todos,
                exportDate: new Date().toISOString(),
                version: '1.0'
            };
            
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `todos-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            
            this.showToast('Tasks exported successfully!', 'success');
        } catch (error) {
            this.showToast('Failed to export tasks', 'error');
            console.error('Export error:', error);
        }
    }

    importTodos(file) {
        if (!file) return;
        
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                const importedTodos = data.todos || data;
                // Schema validation: must be array of objects with required fields
                if (Array.isArray(importedTodos) && importedTodos.length > 0 && importedTodos.every(todo =>
                    typeof todo === 'object' &&
                    typeof todo.id === 'number' &&
                    typeof todo.text === 'string' &&
                    typeof todo.completed === 'boolean' &&
                    typeof todo.priority === 'string' &&
                    typeof todo.category === 'string' &&
                    typeof todo.createdAt === 'string' &&
                    typeof todo.updatedAt === 'string'
                )) {
                    this.todos = importedTodos;
                    this.saveTodos();
                    this.renderTodos();
                    this.updateStats();
                    this.showToast(`Imported ${importedTodos.length} task${importedTodos.length > 1 ? 's' : ''} successfully!`, 'success');
                } else {
                    this.showToast('Invalid file format', 'error');
                }
            } catch (error) {
                this.showToast('Failed to import tasks', 'error');
                console.error('Import error:', error);
            }
        };
        
        reader.readAsText(file);
    }

    showToast(message, type = 'info') {
        const toastContainer = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icon = this.getToastIcon(type);
        toast.innerHTML = `
            <i class="${icon}" aria-hidden="true"></i>
            <span>${message}</span>
        `;
        toastContainer.appendChild(toast);
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 4000);
        this.announceToScreenReader(message);
    }

    showUndoToast(message, undoCallback) {
        const toastContainer = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = 'toast info';
        toast.innerHTML = `
            <i class="${this.getToastIcon('info')}" aria-hidden="true"></i>
            <span>${message}</span>
            <button class="undo-btn" aria-label="Undo">Undo</button>
        `;
        const undoBtn = toast.querySelector('.undo-btn');
        undoBtn.addEventListener('click', () => {
            if (toast.parentNode) toast.remove();
            undoCallback();
        });
        toastContainer.appendChild(toast);
        setTimeout(() => {
            if (toast.parentNode) toast.remove();
        }, 6000);
        this.announceToScreenReader(message + '. Undo available.');
    }

    getToastIcon(type) {
        const icons = {
            success: 'fas fa-check-circle',
            error: 'fas fa-exclamation-circle',
            warning: 'fas fa-exclamation-triangle',
            info: 'fas fa-info-circle'
        };
        return icons[type] || icons.info;
    }

    showLoading() {
        this.isLoading = true;
        const overlay = document.getElementById('loading-overlay');
        overlay.classList.add('show');
    }

    hideLoading() {
        this.isLoading = false;
        const overlay = document.getElementById('loading-overlay');
        overlay.classList.remove('show');
    }

    announceToScreenReader(message) {
        const announcement = document.createElement('div');
        announcement.setAttribute('aria-live', 'polite');
        announcement.setAttribute('aria-atomic', 'true');
        announcement.className = 'sr-only';
        announcement.textContent = message;
        
        document.body.appendChild(announcement);
        
        setTimeout(() => {
            announcement.remove();
        }, 1000);
    }

    setupServiceWorker() {
        if ('serviceWorker' in navigator) {
            // Force CSS to refresh by adding a timestamp parameter
            this.refreshCssFile();
            
            // Clear all caches to ensure fresh content
            if (window.caches) {
                caches.keys().then(function(names) {
                    for (let name of names) {
                        if (name.includes('css') || name.includes('dynamic')) {
                            console.log('Deleting cache:', name);
                            caches.delete(name);
                        }
                    }
                });
            }
            
            // Register or update the service worker
            navigator.serviceWorker.register('sw.js')
                .then(registration => {
                    console.log('SW registered:', registration);
                    
                    // Handle updates
                    registration.addEventListener('updatefound', () => {
                        const newWorker = registration.installing;
                        console.log('New service worker installing:', newWorker);
                        
                        newWorker.addEventListener('statechange', () => {
                            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                                console.log('New service worker installed, sending skipWaiting');
                                newWorker.postMessage({ action: 'skipWaiting' });
                            }
                        });
                    });
                    
                    // If there's an existing controller, tell it to clear CSS cache
                    if (navigator.serviceWorker.controller) {
                        console.log('Telling existing service worker to clear CSS cache');
                        navigator.serviceWorker.controller.postMessage({ 
                            action: 'clearCssCache'
                        });
                    }
                })
                .catch(error => {
                    console.error('SW registration failed:', error);
                });
            
            // Listen for service worker updates
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                console.log('Service worker controller changed, reloading for fresh content');
                // Add a small delay to ensure everything is ready
                setTimeout(() => {
                    // Refresh the CSS one more time before reload
                    this.refreshCssFile();
                    window.location.reload();
                }, 500);
            });
        }
    }
    
    refreshCssFile() {
        // Add timestamp parameter to CSS file to force browser to load fresh copy
        const timestamp = new Date().getTime();
        const cssLink = document.querySelector('link[href^="styles.css"]');
        
        if (cssLink) {
            const href = cssLink.getAttribute('href');
            // Extract base href without query parameters
            const baseHref = href.split('?')[0];
            // Set new href with timestamp
            cssLink.setAttribute('href', `${baseHref}?v=${timestamp}`);
            console.log('CSS refreshed with timestamp:', timestamp);
        } else {
            console.warn('CSS link not found in document');
        }
    }
    
    // Request notification permission on load
    setupNotificationPermission() {
        if ('Notification' in window) {
            if (Notification.permission === 'default') {
                // Show a button to request permission
                let notifBtn = document.getElementById('notification-permission-btn');
                if (!notifBtn) {
                    notifBtn = document.createElement('button');
                    notifBtn.id = 'notification-permission-btn';
                    notifBtn.className = 'export-btn';
                    notifBtn.innerHTML = '<i class="fas fa-bell"></i> Enable Notifications';
                    notifBtn.style.marginLeft = '10px';
                    notifBtn.setAttribute('aria-label', 'Enable notifications');
                    notifBtn.addEventListener('click', () => {
                        Notification.requestPermission().then(permission => {
                            if (permission === 'granted') {
                                this.showToast('Notifications enabled!', 'success');
                                notifBtn.remove();
                            } else {
                                this.showToast('Notifications denied', 'warning');
                            }
                        });
                    });
                    // Add to header or controls
                    const controls = document.querySelector('.control-buttons');
                    if (controls) controls.appendChild(notifBtn);
                }
            }
        }
    }

    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    saveTodos() {
        try {
            localStorage.setItem('todos', JSON.stringify(this.todos));
        } catch (error) {
            console.error('Failed to save todos:', error);
            this.showToast('Failed to save tasks', 'error');
        }
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    getDueDateStatus(dueDate) {
        if (!dueDate) return { class: '', text: '' };
        
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        const due = new Date(dueDate);
        due.setHours(0, 0, 0, 0);
        
        const diffTime = due.getTime() - today.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        
        if (diffDays < 0) {
            return { class: 'overdue', text: 'Overdue' };
        } else if (diffDays === 0) {
            return { class: 'today', text: 'Due today' };
        } else if (diffDays <= 3) {
            return { class: 'upcoming', text: `Due in ${diffDays} day${diffDays > 1 ? 's' : ''}` };
        } else {
            return { class: '', text: `Due ${this.formatDueDate(dueDate)}` };
        }
    }

    formatDueDate(dueDate) {
        const date = new Date(dueDate);
        const today = new Date();
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        
        if (date.toDateString() === today.toDateString()) {
            return 'Today';
        } else if (date.toDateString() === tomorrow.toDateString()) {
            return 'Tomorrow';
        } else {
            return date.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined
            });
        }
    }
}

// Initialize the app
const todoApp = new TodoApp();

// Add CSS for screen reader only content
const style = document.createElement('style');
style.textContent = `
    .sr-only {
        position: absolute;
        width: 1px;
        height: 1px;
        padding: 0;
        margin: -1px;
        overflow: hidden;
        clip: rect(0, 0, 0, 0);
        white-space: nowrap;
        border: 0;
    }
    
    .empty-state {
        text-align: center;
        color: var(--text-secondary);
        padding: 40px 20px;
        font-style: italic;
    }
`;
document.head.appendChild(style); 