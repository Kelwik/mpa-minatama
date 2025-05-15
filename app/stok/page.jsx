'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { supabase } from '@/lib/supabase';
import { getLobsterTypes, getWeightClasses } from '@/lib/cache';
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
import debounce from 'lodash/debounce';

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
const formSchema = z
  .object({
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
  })
  .refine(
    (data) => {
      if (['DISTRIBUTE', 'DEATH', 'DAMAGED'].includes(data.transactionType)) {
        return data.destination && data.destination.trim() !== '';
      }
      return true;
    },
    {
      message: 'Tujuan wajib diisi untuk jenis transaksi ini',
      path: ['destination'],
    }
  );

export default function Stock() {
  const [user, setUser] = useState(null);
  const [stockByType, setStockByType] = useState([]);
  const [weightClasses, setWeightClasses] = useState({});
  const [lobsterTypes, setLobsterTypes] = useState([]);
  const [allWeightClasses, setAllWeightClasses] = useState([]);
  const [availableStock, setAvailableStock] = useState(null);
  const [loading, setLoading] = useState(true);
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
    const {
      data: { session },
    } = await supabase.auth.getSession();
    setUser(session?.user || null);
    setLoading(false);
  }, []);

  // Fetch stock by type
  const fetchStockByType = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('inventory')
        .select('type_id, quantity');
      if (error) throw error;

      const lobsterTypesData = await getLobsterTypes(supabase);
      const grouped = data.reduce((acc, row) => {
        const type = lobsterTypesData.find((t) => t.id === row.type_id);
        const typeName = type?.name;
        if (typeName)
          acc[typeName] = (acc[typeName] || 0) + (row.quantity || 0);
        return acc;
      }, {});
      const stockByTypeArray = Object.entries(grouped).map(
        ([name, total_quantity]) => ({
          lobster_type: name,
          total_quantity,
        })
      );
      setStockByType(stockByTypeArray);
    } catch (error) {
      setError(error.message);
    }
  }, []);

  // Fetch weight classes for all types
  const fetchWeightClasses = useCallback(
    async (types) => {
      try {
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Permintaan timeout')), 3000)
        );

        const { data: inventoryData, error } = await Promise.race([
          supabase
            .from('inventory')
            .select(
              'type_id, weight_class_id, quantity, weight_classes!inner(weight_range)'
            )
            .in(
              'type_id',
              types
                .map(
                  (t) =>
                    lobsterTypes.find((lt) => lt.name === t.lobster_type)?.id
                )
                .filter(Boolean)
            )
            .gt('quantity', 0),
          timeoutPromise,
        ]);
        if (error) throw error;

        const newWeightClasses = types.reduce((acc, type) => {
          const typeId = lobsterTypes.find(
            (lt) => lt.name === type.lobster_type
          )?.id;
          acc[type.lobster_type] = inventoryData
            .filter((row) => row.type_id === typeId)
            .map((row) => ({
              weight_range:
                row.weight_classes?.weight_range || 'Tidak Diketahui',
              quantity: row.quantity || 0,
            }));
          return acc;
        }, {});
        setWeightClasses(newWeightClasses);
      } catch {
        setWeightClasses(
          types.reduce((acc, type) => ({ ...acc, [type.lobster_type]: [] }), {})
        );
      }
    },
    [lobsterTypes]
  );

  // Fetch form options
  const fetchFormOptions = useCallback(async () => {
    try {
      const [typesData, weightClassesData] = await Promise.all([
        getLobsterTypes(supabase),
        getWeightClasses(supabase),
      ]);
      setLobsterTypes(typesData);
      setAllWeightClasses(weightClassesData);
    } catch (error) {
      setError(error.message);
    }
  }, []);

  // Fetch available stock
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
    } catch {
      setAvailableStock(0);
    }
  }, []);

  // Debounced fetch available stock
  const debouncedFetchAvailableStock = useMemo(
    () =>
      debounce(fetchAvailableStock, 300, { leading: false, trailing: true }),
    [fetchAvailableStock]
  );

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
          const currentStock = inventoryData?.quantity || 0;
          if (currentStock < quantity) {
            throw new Error(
              `Stok tidak cukup: hanya ${currentStock} ${lobsterType} (${weightClass}) tersedia`
            );
          }
          if (currentStock === 0) {
            throw new Error(
              `Tidak ada stok untuk ${lobsterType} (${weightClass})`
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
          if (manageError.message.includes('Quantity must be positive')) {
            throw new Error('Jumlah harus bilangan positif');
          }
          if (manageError.message.includes('No inventory exists')) {
            throw new Error(
              `Tidak ada stok untuk ${lobsterType} (${weightClass})`
            );
          }
          if (manageError.message.includes('Insufficient inventory')) {
            const available = manageError.message.match(/\d+/)[0];
            throw new Error(
              `Stok tidak cukup: hanya ${available} ${lobsterType} (${weightClass}) tersedia`
            );
          }
          if (manageError.message.includes('Validation failed')) {
            throw new Error(
              `Stok tidak cukup untuk ${lobsterType} (${weightClass})`
            );
          }
          if (manageError.message.includes('Update failed')) {
            throw new Error(
              `Tidak ada stok untuk ${lobsterType} (${weightClass})`
            );
          }
          if (manageError.message.includes('Destination is required')) {
            throw new Error('Tujuan wajib diisi untuk jenis transaksi ini');
          }
          if (
            manageError.message.includes('function public.manage_inventory')
          ) {
            throw new Error(
              'Fungsi database manage_inventory tidak ditemukan. Silakan hubungi dukungan.'
            );
          }
          throw new Error(manageError.message);
        }

        await fetchStockByType();
        await fetchWeightClasses(stockByType);
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
    [fetchStockByType, stockByType, fetchWeightClasses]
  );

  // Watch form changes
  useEffect(() => {
    const subscription = form.watch((value) => {
      if (value.lobsterType && value.weightClass) {
        debouncedFetchAvailableStock(value.lobsterType, value.weightClass);
      } else {
        setAvailableStock(null);
      }
    });
    return () => {
      subscription.unsubscribe();
      debouncedFetchAvailableStock.cancel();
    };
  }, [form, debouncedFetchAvailableStock]);

  // Initial fetch and real-time subscriptions
  useEffect(() => {
    if (user) {
      const initialize = async () => {
        await Promise.all([fetchStockByType(), fetchFormOptions()]);
        await fetchWeightClasses(stockByType);
      };
      initialize();

      const inventorySubscription = supabase
        .channel('inventory')
        .on(
          'postgres_changes',
          { event: 'UPDATE', schema: 'public', table: 'inventory' },
          async (payload) => {
            await fetchStockByType();
            const affectedTypeId = payload.new.type_id;
            const affectedType = lobsterTypes.find(
              (t) => t.id === affectedTypeId
            )?.name;
            if (affectedType)
              await fetchWeightClasses([{ lobster_type: affectedType }]);
            if (
              form.getValues('lobsterType') &&
              form.getValues('weightClass')
            ) {
              debouncedFetchAvailableStock(
                form.getValues('lobsterType'),
                form.getValues('weightClass')
              );
            }
          }
        )
        .subscribe();

      const transactionsSubscription = supabase
        .channel('transactions')
        .on(
          'postgres_changes',
          { event: 'INSERT', schema: 'public', table: 'transactions' },
          async (payload) => {
            await fetchStockByType();
            const affectedTypeId = payload.new.type_id;
            const affectedType = lobsterTypes.find(
              (t) => t.id === affectedTypeId
            )?.name;
            if (affectedType)
              await fetchWeightClasses([{ lobster_type: affectedType }]);
            if (
              form.getValues('lobsterType') &&
              form.getValues('weightClass')
            ) {
              debouncedFetchAvailableStock(
                form.getValues('lobsterType'),
                form.getValues('weightClass')
              );
            }
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(inventorySubscription);
        supabase.removeChannel(transactionsSubscription);
      };
    }
  }, [
    user,
    fetchStockByType,
    fetchFormOptions,
    fetchWeightClasses,
    stockByType,
    lobsterTypes,
    debouncedFetchAvailableStock,
    form,
  ]);

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

  // Memoized UI data
  const memoizedStockByType = useMemo(() => stockByType, [stockByType]);
  const memoizedWeightClasses = useMemo(() => weightClasses, [weightClasses]);

  // Render loading or error states
  if (loading) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 h-4" />
            </div>
          </header>
          <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
            <p className="text-gray-500 dark:text-gray-400">Memuat stok...</p>
          </div>
        </SidebarInset>
      </SidebarProvider>
    );
  }

  if (!user) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 h-4" />
            </div>
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

  if (error) {
    return (
      <SidebarProvider>
        <AppSidebar />
        <SidebarInset>
          <header className="flex h-16 shrink-0 items-center gap-2">
            <div className="flex items-center gap-2 px-4">
              <SidebarTrigger className="-ml-1" />
              <Separator orientation="vertical" className="mr-2 h-4" />
            </div>
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
        <header className="flex h-16 shrink-0 items-center gap-2">
          <div className="flex items-center gap-2 px-4">
            <SidebarTrigger className="-ml-1" />
            <Separator orientation="vertical" className="mr-2 h-4" />
          </div>
        </header>
        <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
              Manajemen Stok
            </h2>
            <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
              <DialogTrigger asChild>
                <Button className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white">
                  Tambah Transaksi
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-white dark:bg-gray-800 text-gray-900 dark:text-gray-100">
                <DialogHeader>
                  <DialogTitle>Tambah Transaksi</DialogTitle>
                </DialogHeader>
                <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit(submitTransaction)}
                    className="space-y-4"
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
                              <SelectTrigger className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600">
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
                              <SelectTrigger className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600">
                                <SelectValue placeholder="Pilih kelas berat" />
                              </SelectTrigger>
                            </FormControl>
                            <SelectContent className="bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100">
                              {allWeightClasses.map((wc) => (
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
                                <span className="text-sm text-gray-500">
                                  (Tersedia: {availableStock} Ekor)
                                </span>
                              )}
                          </FormLabel>
                          <FormControl>
                            <Input
                              type="number"
                              className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
                              {...field}
                              onChange={(e) =>
                                field.onChange(parseInt(e.target.value))
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
                              <SelectTrigger className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600">
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
                          <FormLabel>
                            Tujuan{' '}
                            {form.watch('transactionType') !== 'ADD' ? (
                              <span className="text-red-500">*</span>
                            ) : (
                              ''
                            )}
                          </FormLabel>
                          <FormControl>
                            <Input
                              className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
                              placeholder="Masukkan tujuan (misalnya, Pasar, Restoran)"
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
                              className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
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
                              className="bg-white dark:bg-gray-700 border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100"
                              {...field}
                            />
                          </FormControl>
                          <FormMessage />
                        </FormItem>
                      )}
                    />
                    {formError && (
                      <p className="text-red-500 dark:text-red-400">
                        {formError}
                      </p>
                    )}
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="border-gray-300 dark:border-gray-600 text-gray-900 dark:text-gray-100 hover:bg-gray-100 dark:hover:bg-gray-700"
                        onClick={() => setIsModalOpen(false)}
                        disabled={isSubmitting}
                      >
                        Batal
                      </Button>
                      <Button
                        type="submit"
                        className="bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600 text-white"
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? 'Mengirim...' : 'Kirim Transaksi'}
                      </Button>
                    </div>
                  </form>
                </Form>
              </DialogContent>
            </Dialog>
          </div>

          {/* Stock by Type */}
          <div className="mb-8">
            <h3 className="text-xl font-semibold mb-4 text-gray-900 dark:text-gray-100">
              Stok Berdasarkan Jenis Lobster
            </h3>
            {memoizedStockByType.length === 0 ? (
              <p className="text-gray-500 dark:text-gray-400">
                Tidak ada data inventaris. Tambah lobster menggunakan tombol di
                atas.
              </p>
            ) : (
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {memoizedStockByType.map((type) => (
                  <Card
                    key={type.lobster_type}
                    className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-sm hover:shadow-md transition-shadow duration-200"
                  >
                    <CardHeader className="pb-2">
                      <CardTitle className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                        {type.lobster_type}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-2">
                      <div className="flex items-center justify-between mb-3">
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          Total
                        </span>
                        <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                          {type.total_quantity} Ekor
                        </span>
                      </div>
                      {memoizedWeightClasses[type.lobster_type]?.length > 0 ? (
                        <div className="space-y-2">
                          {memoizedWeightClasses[type.lobster_type].map(
                            (wc) => (
                              <div
                                key={wc.weight_range}
                                className="flex items-center justify-between py-1 border-t border-gray-100 dark:border-gray-700"
                              >
                                <span className="text-sm text-gray-600 dark:text-gray-400">
                                  {wc.weight_range}
                                </span>
                                <span className="text-sm font-medium text-gray-900 dark:text-gray-100">
                                  {wc.quantity} Ekor
                                </span>
                              </div>
                            )
                          )}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500 dark:text-gray-400 mt-2">
                          Tidak ada kelas berat dengan stok
                        </p>
                      )}
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
