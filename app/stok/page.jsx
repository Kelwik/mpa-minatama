'use client';

import { useState, useEffect, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import * as z from 'zod';
import { AppSidebar } from '@/components/app-sidebar';
import { Skeleton } from '@/components/ui/skeleton';

// Format current date/time for datetime-local
const getCurrentDateTime = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    '0'
  )}-${String(now.getDate()).padStart(2, '0')}T${String(
    now.getHours()
  ).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
};

// Form schema
const formSchema = z.object({
  lobsterType: z.string().min(1, 'Jenis lobster wajib diisi'),
  weightClass: z.string().min(1, 'Kelas berat wajib diisi'),
  quantity: z.number().min(1, 'Jumlah harus minimal 1').int(),
  transactionType: z.enum(['ADD', 'DISTRIBUTE', 'DEATH', 'DAMAGED']),
  destination: z.string().optional(),
  note: z.string().optional(),
  transactionDate: z
    .string()
    .min(1, 'Tanggal transaksi wajib diisi')
    .refine((val) => !isNaN(Date.parse(val)), {
      message: 'Format tanggal tidak valid',
    }),
});

export default function Stock() {
  const [user, setUser] = useState(null);
  const [stockData, setStockData] = useState([]);
  const [lobsterTypes, setLobsterTypes] = useState([]);
  const [weightClasses, setWeightClasses] = useState([]);
  const [availableStock, setAvailableStock] = useState(null);
  const [loading, setLoading] = useState(true);
  const [stockLoading, setStockLoading] = useState(true);
  const [error, setError] = useState(null);
  const [formError, setFormError] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Form setup
  const form = useForm({
    resolver: zodResolver(formSchema),
    defaultValues: {
      lobsterType: '',
      weightClass: '',
      quantity: 1,
      transactionType: 'ADD',
      destination: '',
      note: '',
      transactionDate: getCurrentDateTime(),
    },
  });

  // Check authentication
  const fetchSession = useCallback(async () => {
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      setUser(session?.user || null);
    } catch (error) {
      setError(error.message);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch stock and weight classes
  const fetchStockData = useCallback(async () => {
    try {
      setStockLoading(true);
      const { data, error } = await supabase
        .from('inventory')
        .select(
          `
          type_id,
          weight_class_id,
          quantity,
          lobster_types!inner(name),
          weight_classes!inner(weight_range)
        `
        )
        .gt('quantity', 0);
      if (error) throw error;

      // Group by lobster type
      const grouped = data.reduce((acc, row) => {
        const typeName = row.lobster_types?.name;
        const weightRange =
          row.weight_classes?.weight_range || 'Tidak Diketahui';
        if (!typeName) return acc;

        if (!acc[typeName]) {
          acc[typeName] = {
            lobster_type: typeName,
            total_quantity: 0,
            weight_classes: [],
          };
        }

        acc[typeName].total_quantity += row.quantity || 0;
        const existingWeight = acc[typeName].weight_classes.find(
          (wc) => wc.weight_range === weightRange
        );
        if (existingWeight) {
          existingWeight.quantity += row.quantity || 0;
        } else {
          acc[typeName].weight_classes.push({
            weight_range: weightRange,
            quantity: row.quantity || 0,
          });
        }

        return acc;
      }, {});

      const stockArray = Object.values(grouped)
        .map((item) => ({
          ...item,
          weight_classes: item.weight_classes.sort((a, b) =>
            a.weight_range.localeCompare(b.weight_range)
          ),
        }))
        .sort((a, b) => a.lobster_type.localeCompare(b.lobster_type));

      setStockData(stockArray);
    } catch (error) {
      setError(error.message);
      toast.error('Gagal Memuat Stok', { description: error.message });
    } finally {
      setStockLoading(false);
    }
  }, []);

  // Fetch form options
  const fetchFormOptions = useCallback(async () => {
    try {
      const { data: typesData, error: typesError } = await supabase
        .from('lobster_types')
        .select('id, name');
      if (typesError) throw typesError;

      const { data: weightClassesData, error: weightError } = await supabase
        .from('weight_classes')
        .select('id, weight_range');
      if (weightError) throw weightError;

      setLobsterTypes(typesData);
      setWeightClasses(weightClassesData);
    } catch (error) {
      setError(error.message);
      toast.error('Gagal Memuat Opsi Form', { description: error.message });
    }
  }, []);

  // Fetch available stock for form
  const fetchAvailableStock = useCallback(async (lobsterType, weightClass) => {
    if (!lobsterType || !weightClass) {
      setAvailableStock(null);
      return;
    }
    try {
      const [typeData, weightClassData] = await Promise.all([
        supabase
          .from('lobster_types')
          .select('id')
          .eq('name', lobsterType)
          .single(),
        supabase
          .from('weight_classes')
          .select('id')
          .eq('weight_range', weightClass)
          .single(),
      ]);
      if (typeData.error || weightClassData.error)
        throw new Error('Jenis atau kelas berat tidak valid');

      const { data: inventoryData, error } = await supabase
        .from('inventory')
        .select('quantity')
        .eq('type_id', typeData.data.id)
        .eq('weight_class_id', weightClassData.data.id)
        .single();
      if (error && error.code !== 'PGRST116') throw error;

      setAvailableStock(inventoryData?.quantity || 0);
    } catch (error) {
      setAvailableStock(0);
      toast.error('Gagal Memuat Stok Tersedia', { description: error.message });
    }
  }, []);

  // Submit transaction
  const submitTransaction = useCallback(
    async (values) => {
      try {
        setFormError(null);
        setIsSubmitting(true);
        const {
          lobsterType,
          weightClass,
          quantity,
          transactionType,
          destination,
          note,
          transactionDate,
        } = values;

        const [typeData, weightClassData] = await Promise.all([
          supabase
            .from('lobster_types')
            .select('id')
            .eq('name', lobsterType)
            .single(),
          supabase
            .from('weight_classes')
            .select('id')
            .eq('weight_range', weightClass)
            .single(),
        ]);
        if (typeData.error || weightClassData.error)
          throw new Error('Jenis atau kelas berat tidak valid');

        if (['DISTRIBUTE', 'DEATH', 'DAMAGED'].includes(transactionType)) {
          const { data: inventoryData, error } = await supabase
            .from('inventory')
            .select('quantity')
            .eq('type_id', typeData.data.id)
            .eq('weight_class_id', weightClassData.data.id)
            .single();
          if (error && error.code !== 'PGRST116') throw error;

          if (!inventoryData && error?.code === 'PGRST116') {
            throw new Error(
              `Tidak ada stok untuk ${lobsterType} (${weightClass})`
            );
          }
          const currentStock = inventoryData?.quantity || 0;
          if (currentStock < quantity) {
            throw new Error(
              `Stok tidak cukup: hanya ${currentStock} ${lobsterType} (${weightClass}) tersedia`
            );
          }
        }

        const { error: manageError } = await supabase.rpc('manage_inventory', {
          p_type_id: typeData.data.id,
          p_weight_class_id: weightClassData.data.id,
          p_quantity: quantity,
          p_transaction_type: transactionType,
          p_destination: destination || null,
          p_notes: note ? { note } : null,
          p_transaction_date: new Date(transactionDate).toISOString(),
        });
        if (manageError) {
          if (manageError.message.includes('Jumlah harus bilangan positif')) {
            throw new Error('Jumlah harus bilangan positif');
          }
          if (manageError.message.includes('Jenis transaksi tidak valid')) {
            throw new Error('Jenis transaksi tidak valid');
          }
          if (manageError.message.includes('Stok tidak cukup')) {
            const available = manageError.message.match(/\d+/)?.[0] || '0';
            throw new Error(
              `Stok tidak cukup: hanya ${available} ${lobsterType} (${weightClass}) tersedia`
            );
          }
          throw new Error(manageError.message || 'Gagal memproses transaksi');
        }

        await fetchStockData();
        form.reset({
          lobsterType: '',
          weightClass: '',
          quantity: 1,
          transactionType: 'ADD',
          destination: '',
          note: '',
          transactionDate: getCurrentDateTime(),
        });
        setIsModalOpen(false);
        setAvailableStock(null);
        toast.success('Transaksi Berhasil', {
          description: `${quantity} ${lobsterType} (${weightClass}) ${
            transactionType === 'ADD'
              ? 'ditambahkan'
              : transactionType === 'DISTRIBUTE'
              ? 'didistribusikan'
              : transactionType === 'DEATH'
              ? 'dicatat sebagai mati'
              : 'dicatat sebagai rusak'
          } pada ${new Date(transactionDate).toLocaleString('id-ID', {
            dateStyle: 'medium',
            timeStyle: 'short',
          })}.`,
          action: {
            label: 'Lihat Transaksi',
            onClick: () => (window.location.href = '/transaksi'),
          },
        });
      } catch (error) {
        setFormError(error.message);
        toast.error('Transaksi Gagal', { description: error.message });
      } finally {
        setIsSubmitting(false);
      }
    },
    [fetchStockData]
  );

  // Watch form changes
  useEffect(() => {
    const subscription = form.watch((value) => {
      if (value.lobsterType && value.weightClass) {
        fetchAvailableStock(value.lobsterType, value.weightClass);
      } else {
        setAvailableStock(null);
      }
    });
    return () => subscription.unsubscribe();
  }, [form, fetchAvailableStock]);

  // Initial fetch and real-time subscriptions
  useEffect(() => {
    if (user) {
      const initialize = async () => {
        setStockLoading(true);
        try {
          await Promise.all([fetchStockData(), fetchFormOptions()]);
        } catch (error) {
          setError(error.message);
        } finally {
          setStockLoading(false);
        }
      };
      initialize();

      const inventorySubscription = supabase
        .channel('inventory')
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'inventory' },
          fetchStockData
        )
        .subscribe();

      const transactionsSubscription = supabase
        .channel('transactions')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'transactions' },
          fetchStockData
        )
        .subscribe();

      return () => {
        supabase.removeChannel(inventorySubscription);
        supabase.removeChannel(transactionsSubscription);
      };
    }
  }, [user, fetchStockData, fetchFormOptions]);

  // Authentication effect
  useEffect(() => {
    fetchSession();

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_, session) => {
        setUser(session?.user || null);
        setLoading(false);
      }
    );

    return () => authListener.subscription?.unsubscribe();
  }, [fetchSession]);

  // Calculate total stock
  const totalStock = stockData.reduce(
    (sum, type) => sum + type.total_quantity,
    0
  );

  // Render loading state
  if (loading) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
            <Skeleton className="h-8 w-1/3" />
            <Skeleton className="h-96 w-full" />
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  // Render unauthenticated state
  if (!user) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
            <p className="text-gray-500 dark:text-gray-400">
              Silakan masuk untuk melihat stok.
            </p>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  // Render error state
  if (error) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
            <p className="text-red-500 dark:text-red-400">Kesalahan: {error}</p>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset>
        <header className="flex h-16 shrink-0 items-center gap-2 px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator orientation="vertical" className="mr-2 h-4" />
        </header>
        <div className="flex flex-1 flex-col gap-6 p-6 pt-0">
          <div className="flex justify-between items-center">
            <h2 className="text-3xl font-bold text-gray-900 dark:text-gray-100">
              Manajemen Stok
            </h2>
            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
              <DialogTrigger asChild>
                <Button className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white font-semibold px-6 py-2 rounded-md">
                  Tambah Transaksi
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100 max-w-lg">
                <DialogHeader>
                  <DialogTitle className="text-xl font-semibold">
                    Tambah Transaksi
                  </DialogTitle>
                </DialogHeader>
                <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit(submitTransaction)}
                    className="space-y-6"
                  >
                    <FormField
                      control={form.control}
                      name="lobsterType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Jenis Lobster</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded-md">
                                <SelectValue placeholder="Pilih jenis lobster" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                              {lobsterTypes.map((type) => (
                                <SelectItem key={type.id} value={type.name}>
                                  {type.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="weightClass"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Kelas Berat</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded-md">
                                <SelectValue placeholder="Pilih kelas berat" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                              {weightClasses.map((wc) => (
                                <SelectItem key={wc.id} value={wc.weight_range}>
                                  {wc.weight_range}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="quantity"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>
                            Jumlah{' '}
                            {availableStock !== null &&
                              ['DISTRIBUTE', 'DEATH', 'DAMAGED'].includes(
                                form.watch('transactionType')
                              ) && (
                                <span className="text-sm text-gray-500 dark:text-gray-400">
                                  (Tersedia: {availableStock} Ekor)
                                </span>
                              )}
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-md"
                              {...field}
                              onChange={(e) =>
                                field.onChange(parseInt(e.target.value) || 1)
                              }
                              min="1"
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="transactionType"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Jenis Transaksi</FormLabel>
                          <Select
                            onValueChange={field.onChange}
                            value={field.value}
                          >
                            <FormControl>
                              <SelectTrigger className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 rounded-md">
                                <SelectValue placeholder="Pilih jenis transaksi" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                              <SelectItem value="ADD">Penambahan</SelectItem>
                              <SelectItem value="DISTRIBUTE">
                                Distribusi
                              </SelectItem>
                              <SelectItem value="DEATH">Kematian</SelectItem>
                              <SelectItem value="DAMAGED">Kerusakan</SelectItem>
                            </SelectContent>
                          </Select>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="destination"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tujuan/Asal (Opsional)</FormLabel>
                          <FormControl>
                            <Input
                              className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-md"
                              placeholder="Masukkan tujuan atau asal (misalnya, Pasar, Restoran)"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="transactionDate"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Tanggal Transaksi</FormLabel>
                          <FormControl>
                            <Input
                              type="datetime-local"
                              className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-md"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    <FormField
                      control={form.control}
                      name="note"
                      render={({ field }) => (
                        <FormItem>
                          <FormLabel>Catatan (Opsional)</FormLabel>
                          <FormControl>
                            <Input
                              className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 rounded-md"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {formError && (
                      <p className="text-red-500 dark:text-red-400 text-sm">
                        {formError}
                      </p>
                    )}
                    <div className="flex justify-end gap-3">
                      <Button
                        type="button"
                        variant="outline"
                        className="border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-md"
                        onClick={() => setIsModalOpen(false)}
                        disabled={isSubmitting}
                      >
                        Batal
                      </Button>
                      <Button
                        type="submit"
                        className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white rounded-md"
                        disabled={
                          isSubmitting ||
                          (['DISTRIBUTE', 'DEATH', 'DAMAGED'].includes(
                            form.watch('transactionType')
                          ) &&
                            availableStock !== null &&
                            availableStock < form.watch('quantity'))
                        }
                      >
                        {isSubmitting ? 'Mengirim...' : 'Kirim Transaksi'}
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>

          {/* Total Stock Summary */}
          <Card className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg">
            <CardHeader>
              <CardTitle className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Total Stok
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                {totalStock} Ekor
              </p>
            </CardContent>
          </Card>

          {/* Stock by Type */}
          <div>
            <h3 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">
              Stok Berdasarkan Jenis Lobster
            </h3>
            {stockLoading ? (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {Array.from({ length: 3 }).map((_, index) => (
                  <Card
                    key={`skeleton-${index}`}
                    className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg"
                  >
                    <CardHeader>
                      <Skeleton className="h-6 w-1/2" />
                    </CardHeader>
                    <CardContent>
                      <Skeleton className="h-4 w-3/4 mb-2" />
                      <Skeleton className="h-4 w-1/2 mb-2" />
                      <Skeleton className="h-4 w-2/3" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : stockData.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400">
                Tidak ada data inventaris. Tambah lobster menggunakan tombol di
                atas.
              </p>
            ) : (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {stockData.map((type) => (
                  <Card
                    key={type.lobster_type}
                    className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm hover:shadow-md transition-shadow duration-200"
                  >
                    <CardHeader className="pb-3">
                      <CardTitle className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        {type.lobster_type}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          Total
                        </span>
                        <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                          {type.total_quantity} Ekor
                        </span>
                      </div>
                      <div className="space-y-3">
                        {type.weight_classes.length > 0 ? (
                          type.weight_classes.map((wc) => (
                            <div
                              key={wc.weight_range}
                              className="flex items-center justify-between py-2 border-t border-gray-100 dark:border-gray-700"
                            >
                              <span className="text-sm text-gray-600 dark:text-gray-400">
                                {wc.weight_range}
                              </span>
                              <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                {wc.quantity} Ekor
                              </span>
                            </div>
                          ))
                        ) : (
                          <p className="text-sm text-gray-500 dark:text-gray-400">
                            Tidak ada kelas berat dengan stok
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
