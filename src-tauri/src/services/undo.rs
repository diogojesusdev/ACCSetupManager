use std::fs;
use std::path::{Path, PathBuf};

use uuid::Uuid;

use crate::error::AppResult;
use crate::models::UndoState;

#[derive(Debug, Clone)]
pub enum UndoOperation {
    Create {
        path: PathBuf,
        staged_path: Option<PathBuf>,
    },
    Copy {
        paths: Vec<PathBuf>,
        staged_paths: Vec<PathBuf>,
    },
    Rename {
        from: PathBuf,
        to: PathBuf,
    },
    Delete {
        original_path: PathBuf,
        staged_path: PathBuf,
    },
}

#[derive(Debug)]
pub struct UndoManager {
    undo_stack: Vec<UndoOperation>,
    redo_stack: Vec<UndoOperation>,
    staging_dir: PathBuf,
}

impl UndoManager {
    pub fn new(staging_dir: PathBuf) -> Self {
        Self {
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
            staging_dir,
        }
    }

    pub fn push(&mut self, operation: UndoOperation) {
        self.undo_stack.push(operation);
        self.redo_stack.clear();
    }

    pub fn state(&self) -> UndoState {
        UndoState {
            can_undo: !self.undo_stack.is_empty(),
            can_redo: !self.redo_stack.is_empty(),
            undo_label: self.undo_stack.last().map(UndoOperation::label),
            redo_label: self.redo_stack.last().map(UndoOperation::label),
        }
    }

    pub fn undo(&mut self) -> AppResult<()> {
        if let Some(operation) = self.undo_stack.pop() {
            let operation = operation.undo(&self.staging_dir)?;
            self.redo_stack.push(operation);
        }

        Ok(())
    }

    pub fn redo(&mut self) -> AppResult<()> {
        if let Some(operation) = self.redo_stack.pop() {
            let operation = operation.redo()?;
            self.undo_stack.push(operation);
        }

        Ok(())
    }
}

impl UndoOperation {
    pub fn label(&self) -> String {
        match self {
            Self::Create { .. } => "Undo create".to_owned(),
            Self::Copy { .. } => "Undo copy".to_owned(),
            Self::Rename { .. } => "Undo rename".to_owned(),
            Self::Delete { .. } => "Undo delete".to_owned(),
        }
    }

    fn undo(self, staging_dir: &Path) -> AppResult<Self> {
        match self {
            Self::Create { path, staged_path } => {
                let staged_path = if path.exists() {
                    Some(stage_file_copy(&path, staging_dir, staged_path.as_deref())?)
                } else {
                    staged_path
                };

                if path.exists() {
                    fs::remove_file(&path)?;
                }

                Ok(Self::Create { path, staged_path })
            }
            Self::Copy {
                paths,
                staged_paths,
            } => {
                for (path, staged_path) in paths.iter().zip(staged_paths.iter()) {
                    if path.exists() {
                        stage_file_copy(path, staging_dir, Some(staged_path))?;
                        fs::remove_file(path)?;
                    }
                }

                Ok(Self::Copy {
                    paths,
                    staged_paths,
                })
            }
            Self::Rename { from, to } => {
                if to.exists() {
                    fs::rename(&to, &from)?;
                }

                Ok(Self::Rename { from, to })
            }
            Self::Delete {
                original_path,
                staged_path,
            } => {
                if let Some(parent) = original_path.parent() {
                    fs::create_dir_all(parent)?;
                }
                fs::copy(&staged_path, &original_path)?;

                Ok(Self::Delete {
                    original_path,
                    staged_path,
                })
            }
        }
    }

    fn redo(self) -> AppResult<Self> {
        match self {
            Self::Create { path, staged_path } => {
                if let Some(parent) = path.parent() {
                    fs::create_dir_all(parent)?;
                }

                if let Some(staged_path) = &staged_path {
                    fs::copy(staged_path, &path)?;
                } else {
                    fs::write(&path, b"{}\n")?;
                }

                Ok(Self::Create { path, staged_path })
            }
            Self::Copy {
                paths,
                staged_paths,
            } => {
                for (path, staged_path) in paths.iter().zip(staged_paths.iter()) {
                    if let Some(parent) = path.parent() {
                        fs::create_dir_all(parent)?;
                    }

                    fs::copy(staged_path, path)?;
                }

                Ok(Self::Copy {
                    paths,
                    staged_paths,
                })
            }
            Self::Rename { from, to } => {
                if from.exists() {
                    fs::rename(&from, &to)?;
                }

                Ok(Self::Rename { from, to })
            }
            Self::Delete {
                original_path,
                staged_path,
            } => {
                if original_path.exists() {
                    trash::delete(&original_path)?;
                }

                Ok(Self::Delete {
                    original_path,
                    staged_path,
                })
            }
        }
    }
}

fn stage_file_copy(
    source_path: &Path,
    staging_dir: &Path,
    existing_path: Option<&Path>,
) -> AppResult<PathBuf> {
    fs::create_dir_all(staging_dir)?;
    let staged_path = existing_path
        .map(Path::to_path_buf)
        .unwrap_or_else(|| staging_dir.join(format!("{}.json", Uuid::new_v4())));
    fs::copy(source_path, &staged_path)?;
    Ok(staged_path)
}
