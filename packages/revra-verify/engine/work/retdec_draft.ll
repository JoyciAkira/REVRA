source_filename = "test"
target datalayout = "e-m:e-p:64:64-i64:64-f80:128-n8:16:32:64-S128"

@global_var_4010 = global i64 0
@0 = external global i32
@global_var_2020 = local_unnamed_addr constant i32 2147483647

define i64 @_init() local_unnamed_addr {
dec_label_pc_1000:
  %rax.0.reg2mem = alloca i64, !insn.addr !0
  %0 = load i64, i64* inttoptr (i64 16360 to i64*), align 8, !insn.addr !1
  %1 = icmp eq i64 %0, 0, !insn.addr !2
  store i64 0, i64* %rax.0.reg2mem, !insn.addr !3
  br i1 %1, label %dec_label_pc_1016, label %dec_label_pc_1014, !insn.addr !3

dec_label_pc_1014:                                ; preds = %dec_label_pc_1000
  call void @__gmon_start__(), !insn.addr !4
  store i64 ptrtoint (i32* @0 to i64), i64* %rax.0.reg2mem, !insn.addr !4
  br label %dec_label_pc_1016, !insn.addr !4

dec_label_pc_1016:                                ; preds = %dec_label_pc_1014, %dec_label_pc_1000
  %rax.0.reload = load i64, i64* %rax.0.reg2mem
  ret i64 %rax.0.reload, !insn.addr !5
}

define void @function_1030(i64* %d) local_unnamed_addr {
dec_label_pc_1030:
  call void @__cxa_finalize(i64* %d), !insn.addr !6
  ret void, !insn.addr !6
}

define i64 @_start(i64 %arg1, i64 %arg2, i64 %arg3, i64 %arg4, i64 %arg5, i64 %arg6) local_unnamed_addr {
dec_label_pc_1040:
  %stack_var_8 = alloca i64, align 8
  %0 = trunc i64 %arg6 to i32, !insn.addr !7
  %1 = bitcast i64* %stack_var_8 to i8**, !insn.addr !7
  %2 = inttoptr i64 %arg3 to void ()*, !insn.addr !7
  %3 = call i32 @__libc_start_main(i64 4620, i32 %0, i8** nonnull %1, void ()* null, void ()* null, void ()* %2), !insn.addr !7
  %4 = call i64 @__asm_hlt(), !insn.addr !8
  unreachable, !insn.addr !8
}

define i64 @deregister_tm_clones() local_unnamed_addr {
dec_label_pc_1070:
  ret i64 ptrtoint (i64* @global_var_4010 to i64), !insn.addr !9
}

define i64 @register_tm_clones() local_unnamed_addr {
dec_label_pc_10a0:
  ret i64 0, !insn.addr !10
}

define i64 @__do_global_dtors_aux() local_unnamed_addr {
dec_label_pc_10e0:
  %0 = alloca i64
  %1 = load i64, i64* %0
  %2 = load i8, i8* bitcast (i64* @global_var_4010 to i8*), align 8, !insn.addr !11
  %3 = icmp eq i8 %2, 0, !insn.addr !11
  %4 = icmp eq i1 %3, false, !insn.addr !12
  br i1 %4, label %dec_label_pc_1118, label %dec_label_pc_10ed, !insn.addr !12

dec_label_pc_10ed:                                ; preds = %dec_label_pc_10e0
  %5 = load i64, i64* inttoptr (i64 16376 to i64*), align 8, !insn.addr !13
  %6 = icmp eq i64 %5, 0, !insn.addr !13
  br i1 %6, label %dec_label_pc_1107, label %dec_label_pc_10fb, !insn.addr !14

dec_label_pc_10fb:                                ; preds = %dec_label_pc_10ed
  %7 = load i64, i64* inttoptr (i64 16392 to i64*), align 8, !insn.addr !15
  %8 = inttoptr i64 %7 to i64*, !insn.addr !16
  call void @__cxa_finalize(i64* %8), !insn.addr !16
  br label %dec_label_pc_1107, !insn.addr !16

dec_label_pc_1107:                                ; preds = %dec_label_pc_10fb, %dec_label_pc_10ed
  %9 = call i64 @deregister_tm_clones(), !insn.addr !17
  store i8 1, i8* bitcast (i64* @global_var_4010 to i8*), align 8, !insn.addr !18
  ret i64 %9, !insn.addr !19

dec_label_pc_1118:                                ; preds = %dec_label_pc_10e0
  ret i64 %1, !insn.addr !20

; uselistorder directives
  uselistorder i64 0, { 3, 1, 0, 4, 2 }
}

define i64 @frame_dummy() local_unnamed_addr {
dec_label_pc_1120:
  %0 = call i64 @register_tm_clones(), !insn.addr !21
  ret i64 %0, !insn.addr !21
}

define i1 @_Z5func0St6vectorIfSaIfEEf(i64 %arg1, float %arg2) local_unnamed_addr {
dec_label_pc_1129:
  %storemerge2.reg2mem = alloca i1, !insn.addr !22
  %storemerge.reg2mem = alloca i32, !insn.addr !22
  %0 = bitcast float %arg2 to i32
  %1 = sext i32 %0 to i128
  %2 = call i64 @__asm_movss(i128 %1), !insn.addr !23
  %3 = trunc i64 %2 to i32, !insn.addr !23
  %sext = mul i64 %arg1, 4294967296
  %4 = ashr exact i64 %sext, 32, !insn.addr !24
  %5 = inttoptr i64 %4 to i64*
  store i32 0, i32* %storemerge.reg2mem, !insn.addr !25
  br label %dec_label_pc_11e1, !insn.addr !25

dec_label_pc_1156:                                ; preds = %dec_label_pc_11bd
  %6 = call i64 @_ZNSt6vectorIfSaIfEEixEm(i64* %5, i64 %27), !insn.addr !26
  %7 = inttoptr i64 %6 to i32*, !insn.addr !27
  %8 = load i32, i32* %7, align 4, !insn.addr !27
  %9 = call i128 @__asm_movss.1(i32 %8), !insn.addr !27
  %10 = call i64 @__asm_movss(i128 %9), !insn.addr !28
  %11 = trunc i64 %10 to i32, !insn.addr !28
  %12 = call i64 @_ZNSt6vectorIfSaIfEEixEm(i64* %5, i64 %22), !insn.addr !29
  %13 = inttoptr i64 %12 to i32*, !insn.addr !30
  %14 = load i32, i32* %13, align 4, !insn.addr !30
  %15 = call i128 @__asm_movss.1(i32 %14), !insn.addr !30
  %16 = call i128 @__asm_movss.1(i32 %11), !insn.addr !31
  %17 = call i128 @__asm_subss(i128 %16, i128 %15), !insn.addr !32
  %18 = call i32 @__asm_movd(i128 %17), !insn.addr !33
  %19 = call i128 @__asm_movd.2(i32 %18), !insn.addr !34
  %20 = call i128 @_ZSt3absf(float bitcast (i32 ptrtoint (i32* @0 to i32) to float)), !insn.addr !35
  %21 = call i128 @__asm_movss.1(i32 %3), !insn.addr !36
  call void @__asm_comiss(i128 %21, i128 %20), !insn.addr !37
  store i1 true, i1* %storemerge2.reg2mem
  br label %dec_label_pc_1206

dec_label_pc_11bd:                                ; preds = %dec_label_pc_11e1
  %storemerge3 = add i32 %storemerge.reload, 1
  %22 = sext i32 %storemerge3 to i64, !insn.addr !38
  %23 = call i64 @_ZNKSt6vectorIfSaIfEE4sizeEv(i64* %5), !insn.addr !39
  %24 = icmp ugt i64 %23, %22, !insn.addr !40
  %25 = icmp eq i1 %24, false, !insn.addr !41
  %26 = icmp eq i1 %25, false, !insn.addr !42
  store i32 %storemerge3, i32* %storemerge.reg2mem, !insn.addr !42
  br i1 %26, label %dec_label_pc_1156, label %dec_label_pc_11e1, !insn.addr !42

dec_label_pc_11e1:                                ; preds = %dec_label_pc_11bd, %dec_label_pc_1129
  %storemerge.reload = load i32, i32* %storemerge.reg2mem
  %27 = sext i32 %storemerge.reload to i64, !insn.addr !43
  %28 = call i64 @_ZNKSt6vectorIfSaIfEE4sizeEv(i64* %5), !insn.addr !44
  %29 = icmp ugt i64 %28, %27, !insn.addr !45
  %30 = icmp eq i1 %29, false, !insn.addr !46
  %31 = icmp eq i1 %30, false, !insn.addr !47
  store i1 false, i1* %storemerge2.reg2mem, !insn.addr !47
  br i1 %31, label %dec_label_pc_11bd, label %dec_label_pc_1206, !insn.addr !47

dec_label_pc_1206:                                ; preds = %dec_label_pc_11e1, %dec_label_pc_1156
  %storemerge2.reload = load i1, i1* %storemerge2.reg2mem
  ret i1 %storemerge2.reload, !insn.addr !48

; uselistorder directives
  uselistorder i64 %27, { 1, 0 }
  uselistorder i64 %22, { 1, 0 }
  uselistorder i64* %5, { 3, 2, 1, 0 }
  uselistorder i1 false, { 0, 5, 2, 4, 1, 3 }
  uselistorder i64 (i64*, i64)* @_ZNSt6vectorIfSaIfEEixEm, { 1, 0 }
}

define i32 @main() local_unnamed_addr {
dec_label_pc_120c:
  ret i32 0, !insn.addr !49

; uselistorder directives
  uselistorder i32 0, { 1, 0 }
}

define i128 @_ZSt3absf(float %arg1) local_unnamed_addr {
dec_label_pc_121b:
  %0 = alloca i128
  %1 = load i128, i128* %0
  %2 = call i64 @__asm_movss(i128 %1), !insn.addr !50
  %3 = trunc i64 %2 to i32, !insn.addr !50
  %4 = call i128 @__asm_movss.1(i32 %3), !insn.addr !51
  %5 = call i128 @__asm_movss.1(i32 2147483647), !insn.addr !52
  %6 = call i128 @__asm_andps(i128 %4, i128 %5), !insn.addr !53
  ret i128 %6, !insn.addr !54
}

define i64 @_ZNKSt6vectorIfSaIfEE4sizeEv(i64* %result) local_unnamed_addr {
dec_label_pc_123a:
  %0 = ptrtoint i64* %result to i64
  %1 = add i64 %0, 8, !insn.addr !55
  %2 = inttoptr i64 %1 to i64*, !insn.addr !55
  %3 = load i64, i64* %2, align 8, !insn.addr !55
  %4 = sub i64 %3, %0, !insn.addr !56
  %5 = ashr i64 %4, 2, !insn.addr !57
  ret i64 %5, !insn.addr !58
}

define i64 @_ZNSt6vectorIfSaIfEEixEm(i64* %result, i64 %arg2) local_unnamed_addr {
dec_label_pc_1262:
  %0 = ptrtoint i64* %result to i64
  %1 = mul i64 %arg2, 4, !insn.addr !59
  %2 = add i64 %1, %0, !insn.addr !60
  ret i64 %2, !insn.addr !61
}

define i64 @_fini() local_unnamed_addr {
dec_label_pc_1288:
  %0 = alloca i64
  %1 = load i64, i64* %0
  ret i64 %1, !insn.addr !62

; uselistorder directives
  uselistorder i32 1, { 2, 0, 6, 4, 3, 1, 7, 5 }
}

declare i32 @__libc_start_main(i64, i32, i8**, void ()*, void ()*, void ()*) local_unnamed_addr

declare void @__gmon_start__() local_unnamed_addr

declare void @__cxa_finalize(i64*) local_unnamed_addr

declare i64 @__asm_hlt() local_unnamed_addr

declare i64 @__asm_movss(i128) local_unnamed_addr

declare i128 @__asm_movss.1(i32) local_unnamed_addr

declare i128 @__asm_subss(i128, i128) local_unnamed_addr

declare i32 @__asm_movd(i128) local_unnamed_addr

declare i128 @__asm_movd.2(i32) local_unnamed_addr

declare void @__asm_comiss(i128, i128) local_unnamed_addr

declare i128 @__asm_andps(i128, i128) local_unnamed_addr

!0 = !{i64 4096}
!1 = !{i64 4104}
!2 = !{i64 4111}
!3 = !{i64 4114}
!4 = !{i64 4116}
!5 = !{i64 4122}
!6 = !{i64 4148}
!7 = !{i64 4191}
!8 = !{i64 4197}
!9 = !{i64 4248}
!10 = !{i64 4312}
!11 = !{i64 4324}
!12 = !{i64 4331}
!13 = !{i64 4334}
!14 = !{i64 4345}
!15 = !{i64 4347}
!16 = !{i64 4354}
!17 = !{i64 4359}
!18 = !{i64 4364}
!19 = !{i64 4372}
!20 = !{i64 4376}
!21 = !{i64 4388}
!22 = !{i64 4393}
!23 = !{i64 4410}
!24 = !{i64 4583}
!25 = !{i64 4422}
!26 = !{i64 4454}
!27 = !{i64 4459}
!28 = !{i64 4463}
!29 = !{i64 4484}
!30 = !{i64 4489}
!31 = !{i64 4493}
!32 = !{i64 4498}
!33 = !{i64 4502}
!34 = !{i64 4506}
!35 = !{i64 4510}
!36 = !{i64 4515}
!37 = !{i64 4520}
!38 = !{i64 4544}
!39 = !{i64 4554}
!40 = !{i64 4559}
!41 = !{i64 4565}
!42 = !{i64 4567}
!43 = !{i64 4580}
!44 = !{i64 4590}
!45 = !{i64 4595}
!46 = !{i64 4601}
!47 = !{i64 4603}
!48 = !{i64 4619}
!49 = !{i64 4634}
!50 = !{i64 4643}
!51 = !{i64 4648}
!52 = !{i64 4653}
!53 = !{i64 4661}
!54 = !{i64 4665}
!55 = !{i64 4682}
!56 = !{i64 4696}
!57 = !{i64 4699}
!58 = !{i64 4704}
!59 = !{i64 4733}
!60 = !{i64 4737}
!61 = !{i64 4741}
!62 = !{i64 4756}
