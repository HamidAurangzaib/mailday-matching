import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { UserPlus, Trash2, KeyRound, ShieldCheck, Shield } from "lucide-react";
import { format, parseISO } from "date-fns";

interface AppUser {
  id: string;
  email: string;
  role: "admin" | "va";
  created_at: string;
}

function useUsers() {
  return useQuery<AppUser[]>({
    queryKey: ["users"],
    queryFn: () => customFetch<AppUser[]>("/api/users"),
  });
}

function useCreateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { email: string; password: string; role: string }) =>
      customFetch<AppUser>("/api/users", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

function useUpdateUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; role?: string; password?: string }) =>
      customFetch<AppUser>(`/api/users/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      customFetch(`/api/users/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["users"] }),
  });
}

export default function Users() {
  const { toast } = useToast();
  const { user: currentUser } = useAuth();
  const { data: users = [], isLoading } = useUsers();
  const createMutation = useCreateUser();
  const updateMutation = useUpdateUser();
  const deleteMutation = useDeleteUser();

  const [createOpen, setCreateOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState<AppUser | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AppUser | null>(null);

  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState("va");
  const [newResetPassword, setNewResetPassword] = useState("");

  const handleCreate = () => {
    createMutation.mutate(
      { email: newEmail, password: newPassword, role: newRole },
      {
        onSuccess: () => {
          toast({ title: "User created", description: `${newEmail} can now log in.` });
          setCreateOpen(false);
          setNewEmail("");
          setNewPassword("");
          setNewRole("va");
        },
        onError: (err) => {
          toast({ title: "Failed to create user", description: err.message, variant: "destructive" });
        },
      }
    );
  };

  const handleResetPassword = () => {
    if (!resetOpen) return;
    updateMutation.mutate(
      { id: resetOpen.id, password: newResetPassword },
      {
        onSuccess: () => {
          toast({ title: "Password updated", description: `Password reset for ${resetOpen.email}.` });
          setResetOpen(null);
          setNewResetPassword("");
        },
        onError: (err) => {
          toast({ title: "Failed to reset password", description: err.message, variant: "destructive" });
        },
      }
    );
  };

  const handleToggleRole = (u: AppUser) => {
    const newRole = u.role === "admin" ? "va" : "admin";
    updateMutation.mutate(
      { id: u.id, role: newRole },
      {
        onSuccess: () => {
          toast({ title: "Role updated", description: `${u.email} is now ${newRole === "admin" ? "an Admin" : "a VA"}.` });
        },
        onError: (err) => {
          toast({ title: "Failed to update role", description: err.message, variant: "destructive" });
        },
      }
    );
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    deleteMutation.mutate(deleteTarget.id, {
      onSuccess: () => {
        toast({ title: "User removed", description: `${deleteTarget.email} has been deleted.` });
        setDeleteTarget(null);
      },
      onError: (err) => {
        toast({ title: "Failed to delete user", description: err.message, variant: "destructive" });
      },
    });
  };

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-heading font-bold">User Management</h1>
          <p className="text-muted-foreground mt-1">Manage admin and VA accounts.</p>
        </div>
        <Button onClick={() => setCreateOpen(true)}>
          <UserPlus className="w-4 h-4 mr-2" />
          Add User
        </Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
      ) : (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-medium text-muted-foreground">
              {users.length} {users.length === 1 ? "user" : "users"}
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y">
              {users.map((u) => {
                const isMe = u.id === currentUser?.id;
                return (
                  <div key={u.id} className="flex items-center justify-between px-6 py-4">
                    <div className="flex items-center gap-4">
                      <div className={`w-9 h-9 rounded-full flex items-center justify-center text-white text-sm font-bold ${u.role === "admin" ? "bg-primary" : "bg-muted-foreground"}`}>
                        {u.email[0].toUpperCase()}
                      </div>
                      <div>
                        <div className="font-medium flex items-center gap-2">
                          {u.email}
                          {isMe && <span className="text-xs text-muted-foreground">(you)</span>}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Joined {format(parseISO(u.created_at), "MMM d, yyyy")}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Badge
                        variant={u.role === "admin" ? "default" : "secondary"}
                        className={u.role === "admin" ? "bg-primary" : ""}
                      >
                        {u.role === "admin" ? (
                          <><ShieldCheck className="w-3 h-3 mr-1" />Admin</>
                        ) : (
                          <><Shield className="w-3 h-3 mr-1" />VA</>
                        )}
                      </Badge>

                      <Button
                        variant="ghost"
                        size="sm"
                        title={`Switch to ${u.role === "admin" ? "VA" : "Admin"}`}
                        disabled={isMe || updateMutation.isPending}
                        onClick={() => handleToggleRole(u)}
                      >
                        {u.role === "admin" ? (
                          <Shield className="w-4 h-4 text-muted-foreground" />
                        ) : (
                          <ShieldCheck className="w-4 h-4 text-muted-foreground" />
                        )}
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        title="Reset password"
                        onClick={() => { setResetOpen(u); setNewResetPassword(""); }}
                      >
                        <KeyRound className="w-4 h-4 text-muted-foreground" />
                      </Button>

                      <Button
                        variant="ghost"
                        size="sm"
                        title="Delete user"
                        disabled={isMe}
                        onClick={() => setDeleteTarget(u)}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Create User Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-email">Email</Label>
              <Input
                id="new-email"
                type="email"
                placeholder="name@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-password">Temporary Password</Label>
              <Input
                id="new-password"
                type="password"
                placeholder="Min. 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-role">Role</Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger id="new-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="va">VA — can view queue and history</SelectItem>
                  <SelectItem value="admin">Admin — full access</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreate}
              disabled={!newEmail || !newPassword || createMutation.isPending}
            >
              {createMutation.isPending ? "Creating..." : "Create User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Reset Password Dialog */}
      <Dialog open={!!resetOpen} onOpenChange={(open) => !open && setResetOpen(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Set a new password for <strong>{resetOpen?.email}</strong>. They will need to use this to log in.
          </p>
          <div className="space-y-1.5 py-2">
            <Label htmlFor="reset-password">New Password</Label>
            <Input
              id="reset-password"
              type="password"
              placeholder="Min. 8 characters"
              value={newResetPassword}
              onChange={(e) => setNewResetPassword(e.target.value)}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setResetOpen(null)}>Cancel</Button>
            <Button
              onClick={handleResetPassword}
              disabled={newResetPassword.length < 8 || updateMutation.isPending}
            >
              {updateMutation.isPending ? "Saving..." : "Update Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove user?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.email}</strong>. They will no longer be able to log in. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDelete}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Removing..." : "Remove User"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
