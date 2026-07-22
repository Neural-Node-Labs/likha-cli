import React, { useEffect, useState } from "react";
import { api, User } from "../api/client";

export function AdminPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [showAddUser, setShowAddUser] = useState(false);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"admin" | "user">("user");
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editUsername, setEditUsername] = useState("");
  const [editRole, setEditRole] = useState<"admin" | "user">("user");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    loadUsers();
  }, []);

  const loadUsers = async () => {
    try {
      const res = await api.listUsers();
      if (res.success && res.data) {
        setUsers(res.data as User[]);
      } else {
        showMessage("error", res.error ?? "Failed to load users");
      }
    } catch (err) {
      showMessage("error", err instanceof Error ? err.message : "Failed to load users");
    }
  };

  const showMessage = (type: "success" | "error", text: string) => {
    setMessage({ type, text });
    setTimeout(() => setMessage(null), 3000);
  };

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword.trim()) {
      showMessage("error", "Username and password are required");
      return;
    }
    const res = await api.createUser(newUsername.trim(), newPassword, newRole);
    if (res.success) {
      showMessage("success", `User "${newUsername}" created`);
      setNewUsername("");
      setNewPassword("");
      setNewRole("user");
      setShowAddUser(false);
      loadUsers();
    } else {
      showMessage("error", res.error ?? "Failed to create user");
    }
  };

  const handleUpdateUser = async (id: string) => {
    const res = await api.updateUser(id, {
      username: editUsername.trim() || undefined,
      role: editRole,
    });
    if (res.success) {
      showMessage("success", "User updated");
      setEditingUserId(null);
      loadUsers();
    } else {
      showMessage("error", res.error ?? "Failed to update user");
    }
  };

  const handleDeleteUser = async (id: string) => {
    if (!confirm("Are you sure you want to delete this user?")) return;
    const res = await api.deleteUser(id);
    if (res.success) {
      showMessage("success", "User deleted");
      loadUsers();
    } else {
      showMessage("error", res.error ?? "Failed to delete user");
    }
  };

  const startEdit = (user: User) => {
    setEditingUserId(user.id);
    setEditUsername(user.username);
    setEditRole(user.role);
  };

  const sectionStyle: React.CSSProperties = {
    background: "var(--color-card-bg)",
    border: "1px solid var(--color-border)",
    borderRadius: "10px",
    padding: "24px",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 12px",
    borderRadius: "6px",
    border: "1px solid var(--color-border)",
    background: "var(--color-input-bg)",
    color: "var(--color-text)",
    fontSize: "14px",
    outline: "none",
    boxSizing: "border-box",
  };

  const btnStyle = (variant: "primary" | "danger" | "ghost" = "primary"): React.CSSProperties => ({
    padding: "6px 14px",
    borderRadius: "6px",
    border: variant === "ghost" ? "1px solid var(--color-border)" : "none",
    background: variant === "primary" ? "var(--color-primary)" : variant === "danger" ? "var(--color-error)" : "transparent",
    color: variant === "ghost" ? "var(--color-text-secondary)" : "#fff",
    fontSize: "13px",
    fontWeight: 500,
    cursor: "pointer",
    transition: "all 0.15s ease",
  });

  return (
    <div>
      <h1 style={{ fontSize: "24px", fontWeight: 700, marginBottom: "8px" }}>Admin Panel</h1>
      <p style={{ color: "var(--color-text-secondary)", fontSize: "14px", marginBottom: "24px" }}>
        User management and system administration
      </p>

      {message && (
        <div
          style={{
            padding: "10px 16px",
            borderRadius: "6px",
            marginBottom: "16px",
            fontSize: "13px",
            fontWeight: 500,
            background: message.type === "success"
              ? "color-mix(in srgb, var(--color-success) 15%, transparent)"
              : "color-mix(in srgb, var(--color-error) 15%, transparent)",
            color: message.type === "success" ? "var(--color-success)" : "var(--color-error)",
          }}
        >
          {message.text}
        </div>
      )}

      <div style={sectionStyle}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
          <h2 style={{ fontSize: "18px", fontWeight: 600, margin: 0 }}>User Management</h2>
          <button onClick={() => setShowAddUser(!showAddUser)} style={btnStyle("primary")}>
            {showAddUser ? "Cancel" : "Add User"}
          </button>
        </div>

        {showAddUser && (
          <form
            onSubmit={handleAddUser}
            style={{
              background: "var(--color-bg-secondary)",
              padding: "16px",
              borderRadius: "8px",
              marginBottom: "16px",
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              maxWidth: "400px",
            }}
          >
            <input
              type="text"
              placeholder="Username"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              style={inputStyle}
              aria-label="Username"
            />
            <input
              type="password"
              placeholder="Password"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              style={inputStyle}
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as "admin" | "user")}
              style={inputStyle}
              data-testid="role-selector"
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
            <button type="submit" style={btnStyle("primary")}>
              Create User
            </button>
          </form>
        )}

        <div data-testid="user-list">
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "14px" }}>
            <thead>
              <tr style={{ color: "var(--color-text-secondary)", fontSize: "12px", textTransform: "uppercase" }}>
                <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--color-border)" }}>ID</th>
                <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--color-border)" }}>Username</th>
                <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--color-border)" }}>Role</th>
                <th style={{ textAlign: "left", padding: "8px 12px", borderBottom: "1px solid var(--color-border)" }}>Created</th>
                <th style={{ textAlign: "right", padding: "8px 12px", borderBottom: "1px solid var(--color-border)" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.id}>
                  {editingUserId === user.id ? (
                    <>
                      <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-border)" }}>{user.id}</td>
                      <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-border)" }}>
                        <input
                          type="text"
                          value={editUsername}
                          onChange={(e) => setEditUsername(e.target.value)}
                          style={{ ...inputStyle, width: "140px" }}
                          aria-label="Username"
                        />
                      </td>
                      <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-border)" }}>
                        <select
                          value={editRole}
                          onChange={(e) => setEditRole(e.target.value as "admin" | "user")}
                          style={{ ...inputStyle, width: "100px" }}
                          data-testid="role-selector"
                        >
                          <option value="user">User</option>
                          <option value="admin">Admin</option>
                        </select>
                      </td>
                      <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-border)", color: "var(--color-text-secondary)", fontSize: "12px" }}>
                        {new Date(user.createdAt).toLocaleDateString()}
                      </td>
                      <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-border)", textAlign: "right" }}>
                        <button onClick={() => handleUpdateUser(user.id)} style={{ ...btnStyle("primary"), marginRight: "6px" }}>Save</button>
                        <button onClick={() => setEditingUserId(null)} style={btnStyle("ghost")}>Cancel</button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>{user.id}</td>
                      <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-border)" }}>{user.username}</td>
                      <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-border)" }}>
                        <span style={{
                          background: user.role === "admin" ? "color-mix(in srgb, var(--color-primary) 20%, transparent)" : "color-mix(in srgb, var(--color-text-secondary) 15%, transparent)",
                          color: user.role === "admin" ? "var(--color-primary)" : "var(--color-text-secondary)",
                          padding: "2px 8px",
                          borderRadius: "4px",
                          fontSize: "12px",
                          fontWeight: 500,
                        }}>
                          {user.role}
                        </span>
                      </td>
                      <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-border)", color: "var(--color-text-secondary)", fontSize: "12px" }}>
                        {new Date(user.createdAt).toLocaleDateString()}
                      </td>
                      <td style={{ padding: "8px 12px", borderBottom: "1px solid var(--color-border)", textAlign: "right" }}>
                        <button onClick={() => startEdit(user)} style={{ ...btnStyle("ghost"), marginRight: "6px" }}>Edit</button>
                        <button onClick={() => handleDeleteUser(user.id)} style={btnStyle("danger")}>Delete</button>
                      </td>
                    </>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}


