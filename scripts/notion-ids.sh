#!/bin/bash
# Notion MCP Server - Database and Data Source IDs
#
# Copy this file to notion-ids.local.sh and fill in your IDs.
# Source it before running the MCP server: source scripts/notion-ids.local.sh
#
# The server dynamically discovers all NOTION_DS_* and NOTION_DB_* env vars.
# Add as many workspaces and database types as you need.
#
# Pattern:
#   NOTION_DS_{TYPE}_{WORKSPACE} = data_source ID (preferred, 2025-09-03 API)
#   NOTION_DB_{TYPE}_{WORKSPACE} = database ID (fallback)
#
# Finding your IDs:
#   1. Search for your database in Notion MCP: notion-search query="Tasks"
#   2. Look for results with type="data_source" - use that ID for NOTION_DS_*
#   3. The URL in the result contains the database ID for NOTION_DB_*

# ============================================
# Example configuration (replace with your IDs)
# ============================================

# Workspace: personal
# export NOTION_DS_TASKS_PERSONAL="your-data-source-id-here"
# export NOTION_DB_TASKS_PERSONAL="your-database-id-here"
# export NOTION_DS_PROJECTS_PERSONAL="..."
# export NOTION_DS_NOTES_PERSONAL="..."
# export NOTION_DS_AREAS_PERSONAL="..."

# Workspace: work
# export NOTION_DS_TASKS_WORK="..."
# export NOTION_DB_TASKS_WORK="..."

# ============================================
# Your configuration below
# ============================================

